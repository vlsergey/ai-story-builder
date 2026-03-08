import OpenAI from 'openai'
import { makeLoggingFetch, setVerboseLogging, isVerboseLogging } from './ai-logging.js'

// Re-export so existing callers that imported these from yandex-client.ts keep working
// without changes until each call site is migrated to ai-logging.ts directly.
export { setVerboseLogging, isVerboseLogging, makeLoggingFetch }

const YANDEX_BASE = 'https://ai.api.cloud.yandex.net/v1'

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
