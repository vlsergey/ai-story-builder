import { observable, Observer } from '@trpc/server/observable';
import { EventEmitter } from 'node:events';
import { on } from 'node:events'; // Встроенная функция Node.js

interface PlanEvents {
  update: [id: number];
}

export class EventManager extends EventEmitter<PlanEvents> {
  private events = new EventEmitter<PlanEvents>();

  private readonly path: string;

  // 2. В конструкторе принимаем параметры
  constructor(path: string) {
    super(); // ОБЯЗАТЕЛЬНО: инициализирует EventEmitter
    this.path = path;
  }

  asSubscription() {
    const events = this.events;
    return async function* () {
      const iterable = on(events, 'update');
      for await (const [id] of iterable) {
        yield id as number;
      }
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emitUpdate(payload: number, reason?: string): void {
    console.log(`Emit event ${this.path}: ${JSON.stringify(payload)}` + (reason ? ` (${reason})` : ''));
    this.events.emit('update', payload);
  }
}
/**
 * Превращает асинхронную функцию в tRPC Observable.
 * Автоматически вызывает complete() и обрабатывает ошибки.
 */
export function toObservable<T>(
  run: (emit: Observer<T, unknown>) => Promise<void>
) {
  return observable<T>((emit) => {
    let active = true;

    // Обертка для безопасного вызова emit
    const safeEmit: Observer<T, unknown> = {
      next: (val) => active && emit.next(val),
      error: (err) => active && emit.error(err),
      complete: () => active && emit.complete(),
    };

    run(safeEmit)
      .then(() => safeEmit.complete())
      .catch((err) => safeEmit.error(err));

    // Функция отписки
    return () => { active = false; };
  });
}

export type DataOrEventEvent<Data, Event> = DataEvent<Data> | EventEvent<Event> | CompletedEvent;

interface CompletedEvent {
  type: 'completed';
}

interface DataEvent<Data> {
  type: 'data';
  data: Data;
}

interface EventEvent<E> {
  type: 'event';
  event: E;
}

