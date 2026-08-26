import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { fetchLoadedModels, streamOllamaChat } from "./ollama-client.js"

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

describe("fetchLoadedModels — /api/ps", () => {
  it("reads the window each resident model was actually loaded with", async () => {
    const url = await startServer((req, res) => {
      expect(req.url).toBe("/api/ps")
      expect(req.method).toBe("GET")
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ models: [{ model: "qwen", context_length: 8192 }] }))
    })
    expect(await fetchLoadedModels(url)).toEqual([{ model: "qwen", context_length: 8192 }])
  })

  it("reports an empty list when nothing is loaded", async () => {
    const url = await startServer((_req, res) => res.end(JSON.stringify({ models: [] })))
    expect(await fetchLoadedModels(url)).toEqual([])
  })

  it("tolerates a response with no models key at all", async () => {
    const url = await startServer((_req, res) => res.end("{}"))
    expect(await fetchLoadedModels(url)).toEqual([])
  })

  it("does not choke on a trailing slash in the base url", async () => {
    const url = await startServer((req, res) => {
      expect(req.url).toBe("/api/ps")
      res.end(JSON.stringify({ models: [] }))
    })
    expect(await fetchLoadedModels(url + "/")).toEqual([])
  })
})
