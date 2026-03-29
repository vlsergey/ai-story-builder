import { EventEmitter, on } from 'node:events';
import { ResponseUsage } from 'openai/resources/responses/responses.js';

interface AiEvents {
  onGenerationEvent: [Partial<ResponseUsage>];
}

class LastAiGenerationEventManager {
  private backToFrontEvents = new EventEmitter<AiEvents>();
  private lastEvent: Partial<ResponseUsage> | null = null;

  getLastAiGenerationEvent() {
    return this.lastEvent;
  }

  onAiGenerationEvent(lastEvent: Partial<ResponseUsage>) {
    this.lastEvent = lastEvent;
    console.log(`Emit emitOnGenerationEvent`);
    this.backToFrontEvents.emit('onGenerationEvent', lastEvent);
  }

  onGenerationEventAsSubscription() {
    const backToFrontEvents = this.backToFrontEvents;
    return async function* () {
      const iterable = on(backToFrontEvents, 'onGenerationEvent');

      for await (const event of iterable) {
        yield event as Partial<ResponseUsage>;
      }
    };
  }
}

export default new LastAiGenerationEventManager();