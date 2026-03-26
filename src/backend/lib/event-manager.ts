import { EventEmitter } from 'node:events';

interface PlanEvents {
  update: [id: number];
}

// Используйте этот интерфейс для типизации emit
interface Observer<T> {
  next: (value: T) => void;
  error: (err: unknown) => void;
  complete: () => void;
}

export class EventManager extends EventEmitter<PlanEvents> {
  private events = new EventEmitter<PlanEvents>();

  private readonly path: string;

  // 2. В конструкторе принимаем параметры
  constructor(path: string) {
    super(); // ОБЯЗАТЕЛЬНО: инициализирует EventEmitter
    this.path = path;
  }

  /**
   * Subscribe to events. Returns an async iterator that yields payloads.
   * Suitable for tRPC subscription.
   */
  // Тот самый метод для роутера
  asSubscription() {
    return () => {
      const events = this.events;
      
      return {
        subscribe: (emit: Observer<number>) => {
          const handler = (id: number) => {
            emit.next(id);
          };

          events.on('update', handler);

          // Важно для Electron: возвращаем функцию отписки
          return {
            unsubscribe: () => {
              events.off('update', handler);
            },
          };
        },
      };
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emitUpdate(payload: number): void {
    console.log(`Emit event ${this.path}: ${JSON.stringify(payload)}`);
    this.events.emit('update', payload);
  }
}