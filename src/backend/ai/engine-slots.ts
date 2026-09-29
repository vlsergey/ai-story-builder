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

/** Starts waiting calls while the engine has room: the limit may have been raised meanwhile. */
function wakeWaiting(engineId: AiEngineKey, queue: EngineQueue): void {
  while (queue.waiting.length > 0 && queue.running < maxConcurrentCalls(engineId)) {
    queue.running++
    queue.waiting.shift()?.()
  }
}

/**
 * Runs `call` once the engine has a free slot. Every model call goes through
 * here, so however many nodes a run has ready — or calls come from an editor
 * meanwhile — the engine never gets more requests at once than it takes.
 * Calls start in the order they came; a freed slot goes straight to the next
 * one waiting. An aborted signal gives up the wait.
 */
export async function withEngineSlot<T>(
  engineId: AiEngineKey,
  signal: AbortSignal | undefined,
  call: () => Promise<T>,
): Promise<T> {
  const queue = queueOf(engineId)
  if (signal?.aborted) throw new Error("This operation was aborted")
  if (queue.waiting.length === 0 && queue.running < maxConcurrentCalls(engineId)) {
    // A free slot and nobody before this call: it starts right away.
    queue.running++
  } else {
    await waitForSlot(engineId, queue, signal)
  }
  try {
    return await call()
  } finally {
    queue.running--
    wakeWaiting(engineId, queue)
  }
}

/** Queues the call until `wakeWaiting` gives it a slot, or the signal aborts it. */
function waitForSlot(engineId: AiEngineKey, queue: EngineQueue, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = () => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    const onAbort = () => {
      const at = queue.waiting.indexOf(start)
      if (at < 0) return // it already has its slot
      queue.waiting.splice(at, 1)
      reject(new Error("This operation was aborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    queue.waiting.push(start)
    // The limit may have been raised since the calls before this one queued.
    wakeWaiting(engineId, queue)
  })
}
