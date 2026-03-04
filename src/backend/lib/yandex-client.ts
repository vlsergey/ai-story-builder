import OpenAI from 'openai'

const YANDEX_BASE = 'https://ai.api.cloud.yandex.net/v1'

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
