import { type AiEngineKey, defaultMaxConcurrentCalls } from "../../shared/ai-engines.js"
import { SettingsRepository } from "../settings/settings-repository.js"

/**
 * How many calls the engine takes at once: its `max_concurrent_calls`
 * setting, or the engine's default — one for a local model, ten for a cloud
 * API. Read on every call, so a change applies to the next one.
 */
export function maxConcurrentCalls(engineId: AiEngineKey): number {
  const configured = Number(SettingsRepository.getAllAiEnginesConfig()[engineId]?.max_concurrent_calls)
  return Number.isInteger(configured) && configured >= 1 ? configured : defaultMaxConcurrentCalls(engineId)
}

interface EngineQueue {
  running: number
  waiting: (() => void)[]
}

const queues = new Map<AiEngineKey, EngineQueue>()

function queueOf(engineId: AiEngineKey): EngineQueue {
  let queue = queues.get(engineId)
  if (!queue) {
    queue = { running: 0, waiting: [] }
    queues.set(engineId, queue)
  }
  return queue
}

/**
 * Runs `call` once the engine has a free slot. Every model call goes through
 * here, so however many branches of a parallel loop are ready, the engine
 * never gets more requests at once than it takes. An aborted signal gives up
 * the wait.
 */
export async function withEngineSlot<T>(
  engineId: AiEngineKey,
  signal: AbortSignal | undefined,
  call: () => Promise<T>,
): Promise<T> {
  const queue = queueOf(engineId)
  while (queue.running >= maxConcurrentCalls(engineId)) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("This operation was aborted"))
        return
      }
      const wake = () => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }
      const onAbort = () => {
        queue.waiting.splice(queue.waiting.indexOf(wake), 1)
        reject(new Error("This operation was aborted"))
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      queue.waiting.push(wake)
    })
  }
  queue.running++
  try {
    return await call()
  } finally {
    queue.running--
    queue.waiting.shift()?.()
  }
}
