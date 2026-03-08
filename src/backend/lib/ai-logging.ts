/**
 * Shared AI-provider logging utilities.
 *
 * Provides a toggle for verbose request/response logging used by all AI
 * engine adapters (Yandex, Grok, …) and a logging fetch wrapper factory.
 * Routes and project management code should import from here — never from
 * an engine-specific module.
 */

/** When true, every AI request and response body/headers are printed to the console. */
let verboseLogging = false

export function setVerboseLogging(v: boolean): void {
  verboseLogging = v
}

export function isVerboseLogging(): boolean {
  return verboseLogging
}

/** Masks the token in an Authorization header value, keeping the scheme visible. */
function maskAuth(value: string): string {
  return value.replace(/^(Bearer\s+)\S+$/i, '$1***')
}

/** Normalises request headers (Headers | Record | [k,v][]) to a plain masked object for logging. */
export function maskedHeaders(raw: Parameters<typeof fetch>[1]['headers']): Record<string, string> {
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

/**
 * Returns a fetch wrapper that logs every AI API call to the console.
 *
 * @param providerName  Label used in log lines, e.g. `'Yandex'` or `'Grok'`.
 * @param baseUrl       Base URL stripped from logged URLs for brevity.
 */
export function makeLoggingFetch(
  providerName: string,
  baseUrl: string,
): typeof globalThis.fetch {
  return async function loggingFetch(url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    const method = (init?.method ?? 'GET').padEnd(6)
    const shortUrl = String(url).replace(baseUrl + '/', '')
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
      const ts = new Date().toISOString()
      console.log(`[${providerName}] [${ts}] REQ ${method.trim()} ${shortUrl}`)
      console.log(`[${providerName}] REQ headers: ${JSON.stringify(maskedHeaders(init?.headers))}`)
      if (init?.body && typeof init.body === 'string') {
        console.log(`[${providerName}] REQ body: ${init.body}`)
      } else if (init?.body instanceof FormData) {
        const fields: Record<string, string> = {}
        for (const [k, v] of (init.body as FormData).entries()) {
          fields[k] = v instanceof Blob ? `<Blob size=${v.size} type=${v.type}>` : String(v)
        }
        console.log(`[${providerName}] REQ multipart: ${JSON.stringify(fields)}`)
      }
    }

    let response: Response
    try {
      response = await globalThis.fetch(url, init)
    } catch (e) {
      console.error(`[${providerName}] [${new Date().toISOString()}] ${method} ${shortUrl}${reqSize} — ERROR after ${Date.now() - start}ms: ${e}`)
      throw e
    }

    const elapsed = Date.now() - start
    const contentLength = response.headers.get('content-length')
    const respSize = contentLength ? ` resp:${contentLength}B` : ''
    const traceId = response.headers.get('x-server-trace-id') ?? ''
    const traceStr = traceId ? ` trace:${traceId}` : ''
    const ts = new Date().toISOString()
    console.log(`[${providerName}] [${ts}] ${method} ${shortUrl}${reqSize} → ${response.status} ${elapsed}ms${respSize}${traceStr}`)

    if (!response.ok) {
      // Eagerly read body so it can be included in the error details.
      const bodyText = await response.text()
      if (verboseLogging) {
        console.log(`[${providerName}] RESP body: ${bodyText}`)
      }
      // Embed request context as synthetic headers so formatApiError can report them.
      const augmented = new Headers(response.headers)
      augmented.set('x-request-url', String(url))
      augmented.set('x-request-method', (init?.method ?? 'GET').toUpperCase())
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: augmented,
      })
    }

    // For SSE streaming responses, skip body dump here — the caller (e.g. grokGenerate)
    // logs individual events as they arrive, which is more useful than a bulk dump at the end.
    const isSse = response.headers.get('content-type')?.includes('text/event-stream') ?? false
    if (verboseLogging && !isSse) {
      response.clone().text().then(body => {
        console.log(`[${providerName}] RESP body: ${body}`)
      }).catch(() => {})
    }

    return response
  }
}
