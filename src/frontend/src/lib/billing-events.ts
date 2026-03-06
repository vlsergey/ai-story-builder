export const AI_CALL_COMPLETED_EVENT = 'ai-call-completed'

export interface AiCallCompletedDetail {
  costUsdTicks?: number
  tokensInput?: number
  tokensOutput?: number
}

/** Dispatched after any successful AI generation (generate or improve). */
export function dispatchAiCallCompleted(detail: AiCallCompletedDetail): void {
  window.dispatchEvent(new CustomEvent<AiCallCompletedDetail>(AI_CALL_COMPLETED_EVENT, { detail }))
}
