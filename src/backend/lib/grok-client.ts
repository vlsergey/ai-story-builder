import OpenAI from 'openai'
import { makeLoggingFetch } from './yandex-client.js'

const GROK_BASE = 'https://api.x.ai/v1'

/** Creates an OpenAI-compatible client pointed at the xAI Grok API with request/response logging. */
export function createGrokClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GROK_BASE,
    fetch: makeLoggingFetch('Grok', GROK_BASE),
  })
}
