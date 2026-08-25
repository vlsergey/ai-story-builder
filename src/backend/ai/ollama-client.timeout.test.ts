import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { streamOllamaChat } from "./ollama-client.js"

/**
 * Regression: a local model can spend minutes evaluating a long prompt before
 * Ollama sends a single response header. Node's global fetch gives up after
 * five minutes (UND_ERR_HEADERS_TIMEOUT) and the node dies with "fetch failed",
 * so the transport must not impose a header deadline of its own.
 */
let server: http.Server | null = null

afterEach(async () => {
  if (server) await new Promise<void>((r) => server?.close(() => r()))
  server = null
})

function startServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server?.address() as AddressInfo
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

const REQ = { model: "m", messages: [{ role: "user" as const, content: "x" }], stream: true as const }

async function collect(url: string) {
  const out: string[] = []
  for await (const chunk of streamOllamaChat(url, REQ, new AbortController().signal)) {
    if (chunk.message?.content) out.push(chunk.message.content)
  }
  return out.join("")
}

describe("streamOllamaChat — transport", () => {
  it("survives a long silence before the first header", async () => {
    const url = await startServer((_req, res) => {
      // Headers withheld while the model "evaluates the prompt".
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" })
        res.write(`${JSON.stringify({ message: { content: "поздний" } })}\n`)
        res.end(`${JSON.stringify({ done: true, eval_count: 1 })}\n`)
      }, 600)
    })
    await expect(collect(url)).resolves.toBe("поздний")
  }, 20_000)

  it("reassembles NDJSON split across packet boundaries", async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" })
      const line = JSON.stringify({ message: { content: "склеено" } })
      res.write(line.slice(0, 12))
      setTimeout(() => {
        res.write(`${line.slice(12)}\n`)
        res.end(`${JSON.stringify({ done: true })}\n`)
      }, 50)
    })
    await expect(collect(url)).resolves.toBe("склеено")
  }, 20_000)

  it("reports an HTTP error instead of hanging", async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" })
      res.end("model not found")
    })
    await expect(collect(url)).rejects.toThrow(/500/)
  }, 20_000)

  it("surfaces an error carried inside the stream", async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" })
      res.end(`${JSON.stringify({ error: "context length exceeded" })}\n`)
    })
    await expect(collect(url)).rejects.toThrow(/context length exceeded/)
  }, 20_000)

  it("stops when the caller aborts", async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" })
      res.write(`${JSON.stringify({ message: { content: "первый" } })}\n`)
      // never ends
    })
    const ac = new AbortController()
    const run = (async () => {
      for await (const _ of streamOllamaChat(url, REQ, ac.signal)) ac.abort()
    })()
    await expect(run).rejects.toThrow()
  }, 20_000)
})
