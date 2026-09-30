import type { ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses.js"

/**
 * What a model thinks and looks up during one call, by output index: the
 * items after `event`. Any other event leaves them as they are.
 */
export function thinkingItems(items: ResponseOutputItem[], event: ResponseStreamEvent): ResponseOutputItem[] {
  switch (event.type) {
    case "response.output_item.added":
    case "response.output_item.done": {
      const newItems = [...items]
      newItems[event.output_index] = event.item
      return newItems
    }
    case "response.reasoning_summary_text.delta": {
      // Grok and similar reasoning-capable models stream reasoning text
      // chunk-by-chunk after the reasoning output_item arrives. Accumulate
      // into the item's summary[summary_index].text so the panel can show
      // the live "what the model is thinking" stream.
      const item = items[event.output_index]
      if (!item || item.type !== "reasoning") return items
      const summary = [...(item.summary ?? [])]
      const existing = summary[event.summary_index]
      const prevText = existing?.type === "summary_text" ? existing.text : ""
      summary[event.summary_index] = { type: "summary_text", text: prevText + event.delta }
      const newItems = [...items]
      newItems[event.output_index] = { ...item, summary }
      return newItems
    }
    default:
      return items
  }
}
