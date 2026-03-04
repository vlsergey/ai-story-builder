import OpenAI from 'openai'

const YANDEX_BASE = 'https://ai.api.cloud.yandex.net/v1'

/** When true, every request and response body/headers are printed to the console. */
let verboseLogging = false

export function setVerboseLogging(v: boolean): void {
  verboseLogging = v
}

/** Masks the token in an Authorization header value, keeping the scheme visible. */
function maskAuth(value: string): string {
  return value.replace(/^(Bearer\s+)\S+$/i, '$1***')
}

/** Normalises request headers (Headers | Record | [k,v][]) to a plain masked object for logging. */
function maskedHeaders(raw: Parameters<typeof fetch>[1]['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  if (raw instanceof Headers) {
    raw.forEach((v, k) => { out[k] = k.toLowerCase() === 'authorization' ? maskAuth(v) : v })
  } else if (Array.isArray(raw)) {
    for (const [k, v] of raw as string[][]) {
      out[k] = k.toLowerCase() === 'authorization' ? maskAuth(v) : v
    }
  } else {
    for (const [k, v] of Object.entries(raw as Record<string, string>)) {
      out[k] = k.toLowerCase() === 'authorization' ? maskAuth(v) : v
    }
  }
  return out
}

/** Returns a fetch wrapper that logs every Yandex API call to the console. */
export function makeLoggingFetch(): typeof globalThis.fetch {
  return async function loggingFetch(url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    const method = (init?.method ?? 'GET').padEnd(6)
    const shortUrl = String(url).replace(YANDEX_BASE + '/', '')
    const start = Date.now()

    let reqSize = ''
    if (init?.body) {
      if (typeof init.body === 'string') {
        reqSize = ` req:${Buffer.byteLength(init.body, 'utf-8')}B`
      } else if (Buffer.isBuffer(init.body)) {
        reqSize = ` req:${(init.body as Buffer).length}B`
      } else {
        reqSize = ' req:multipart'
      }
    }

    if (verboseLogging) {
      console.log(`[Yandex] REQ ${method.trim()} ${shortUrl}`)
      console.log(`[Yandex] REQ headers: ${JSON.stringify(maskedHeaders(init?.headers))}`)
      if (init?.body && typeof init.body === 'string') {
        console.log(`[Yandex] REQ body: ${init.body}`)
      }
    }

    let response: Response
    try {
      response = await globalThis.fetch(url, init)
    } catch (e) {
      console.error(`[Yandex] ${method} ${shortUrl}${reqSize} — ERROR after ${Date.now() - start}ms: ${e}`)
      throw e
    }

    const elapsed = Date.now() - start
    const contentLength = response.headers.get('content-length')
    const respSize = contentLength ? ` resp:${contentLength}B` : ''
    const traceId = response.headers.get('x-server-trace-id') ?? ''
    const traceStr = traceId ? ` trace:${traceId}` : ''
    console.log(`[Yandex] ${method} ${shortUrl}${reqSize} → ${response.status} ${elapsed}ms${respSize}${traceStr}`)

    if (verboseLogging) {
      response.clone().text().then(body => {
        console.log(`[Yandex] RESP body: ${body}`)
      }).catch(() => {})
    }

    return response
  }
}

/** Creates an OpenAI-compatible client pointed at the Yandex AI API with request/response logging. */
export function createYandexClient(apiKey: string, folderId: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: YANDEX_BASE,
    project: folderId,
    defaultHeaders: { 'x-folder-id': folderId },
    fetch: makeLoggingFetch(),
  })
}
