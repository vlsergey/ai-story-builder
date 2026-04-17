import { EventEmitter, on } from "node:events"
import { type Observable, type Observer, observable } from "@trpc/server/observable"

interface PlanEvents {
  update: [id: number]
}

export class EventManager {
  private events = new EventEmitter<PlanEvents>()

  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  asSubscription(): Observable<number, unknown> {
    const events = this.events
    return emitterToSingleArgObservable(events, "update")
  }

  /**
   * Emit an event to all subscribers.
   */
  emitUpdate(payload: number, reason?: string): void {
    if (typeof payload !== "number") {
      console.error(`Payload must be a number: ${typeof payload}`, payload)
      throw Error(`Payload must be a number: ${typeof payload}`)
    }
    console.info(`Emit event ${this.path}: ${JSON.stringify(payload)}${reason ? ` (${reason})` : ""}`)
    this.events.emit("update", payload)
  }
}

export function emitterToSingleArgObservable<K extends string, E extends Record<K, any[]>>(
  emitter: EventEmitter<E>,
  eventName: K,
): Observable<E[K][0], unknown> {
  return toObservable<E[K][0]>(async (emit: Observer<E[K], unknown>) => {
    const iterable = on(emitter, eventName) as AsyncIterableIterator<E[K]>
    for await (const [value] of iterable) {
      emit.next(value)
    }
  })
}

/**
 * Превращает асинхронную функцию в tRPC Observable.
 * Автоматически вызывает complete() и обрабатывает ошибки.
 */
export function toObservable<T>(run: (emit: Observer<T, unknown>) => Promise<void>) {
  return observable<T>((emit) => {
    let active = true

    // Обертка для безопасного вызова emit
    const safeEmit: Observer<T, unknown> = {
      next: (val) => active && emit.next(val),
      error: (err) => active && emit.error(err),
      complete: () => active && emit.complete(),
    }

    run(safeEmit)
      .then(() => safeEmit.complete())
      .catch((err) => safeEmit.error(err))

    // Функция отписки
    return () => {
      active = false
    }
  })
}

export type DataOrEventEvent<Data, Event> = DataEvent<Data> | EventEvent<Event> | CompletedEvent

interface CompletedEvent {
  type: "completed"
}

interface DataEvent<Data> {
  type: "data"
  data: Data
}

interface EventEvent<E> {
  type: "event"
  event: E
}
