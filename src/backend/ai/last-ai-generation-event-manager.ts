import { EventEmitter } from "node:events"
import type { ResponseUsage } from "openai/resources/responses/responses.js"
import { type Observable, observable } from "@trpc/server/observable"

interface AiEvents {
  onGenerationEvent: [Partial<ResponseUsage>]
}

class LastAiGenerationEventManager {
  private backToFrontEvents = new EventEmitter<AiEvents>()
  private lastEvent: Partial<ResponseUsage> | null = null

  getLastAiGenerationEvent() {
    return this.lastEvent
  }

  onAiGenerationEvent(lastEvent: Partial<ResponseUsage>) {
    this.lastEvent = lastEvent
    console.log(`Emit emitOnGenerationEvent`)
    this.backToFrontEvents.emit("onGenerationEvent", lastEvent)
  }

  onGenerationEventAsSubscription(): Observable<Partial<ResponseUsage>, unknown> {
    const backToFrontEvents = this.backToFrontEvents
    return observable((emit) => {
      const onData = (data: Partial<ResponseUsage>) => {
        emit.next(data)
      }
      backToFrontEvents.on("onGenerationEvent", onData)
      return () => {
        backToFrontEvents.off("onGenerationEvent", onData)
      }
    })
  }
}

export default new LastAiGenerationEventManager()
