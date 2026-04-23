import type React from "react"
import type { ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { forwardRef, useImperativeHandle, useState } from "react"
import { GlobeIcon, WrenchIcon } from "lucide-react"
import { useLocale } from "@/i18n/locale"
import { SiX } from "@icons-pack/react-simple-icons"

interface AiThinkingPanelProps {
  className?: string
  itemClassName?: string
}

export interface AiThinkingPanelHandle {
  onEvent: (event: ResponseStreamEvent) => void
  onComplete: () => void
}

const icons: Record<string, React.FC<{ className: string }>> = {
  web_search_call: GlobeIcon,
  "custom_tool_call.x_semantic_search": SiX,
  "custom_tool_call.x_keyword_search": SiX,
}

const AiThinkingPanel = forwardRef<AiThinkingPanelHandle, AiThinkingPanelProps>(({ className, itemClassName }, ref) => {
  const { exists, t } = useLocale()
  const [items, setItems] = useState<ResponseOutputItem[]>([])

  useImperativeHandle(ref, () => ({
    onEvent: (event: ResponseStreamEvent) => {
      switch (event.type) {
        case "response.output_item.added":
        case "response.output_item.done":
          setItems((items) => {
            const newItems = [...items]
            newItems[event.output_index] = event.item
            return newItems
          })
      }
      console.log(event)
      return
    },
    onComplete: () => {
      setItems([])
    },
  }))

  return (
    <div className={className ?? "text-muted-foreground"}>
      {items
        .filter((item) => item.type !== "message")
        .slice(-3)
        .map((item, index) => {
          const Icon = icons[item.type] ?? icons[`${item.type}.${(item as any).name}`]
          const icon = Icon ? <Icon className="w-3 h-3" /> : <WrenchIcon className="w-3 h-3" />

          let className = "flex items-center"
          if ((item as any).status === "in_progress" || (item as any).status === "searching") {
            className = "flex items-center animate-pulse"
          }
          if ((item as any).status === "failed") {
            className = "flex items-center text-destructive"
          }

          const i18nKey = `aiThinking.${item.type}${(item as any)?.action?.type ? `.${(item as any).action.type}` : ""}`
          const validKey = exists(i18nKey)

          return (
            <div key={index} className={itemClassName}>
              <div className={className}>
                <div>{icon && icon}</div>
                <div className="flex-1 ml-1 text-xs">
                  <span>
                    {validKey && t(i18nKey)}
                    {!validKey && `${item.type}; ${(item as any)?.action?.type ? `.${(item as any).action.type}` : ""}`}
                  </span>

                  {item.type === "custom_tool_call" && (
                    <span>
                      {": "}
                      {item.name}
                    </span>
                  )}
                  {item.type === "custom_tool_call" && item.input && (
                    <span>
                      {": "}
                      <code>{item.input}</code>
                    </span>
                  )}

                  {item.type === "web_search_call" && item.action.type === "open_page" && (
                    <span>
                      {": "}
                      {item.action.url}
                    </span>
                  )}
                  {item.type === "web_search_call" && item.action.type === "find_in_page" && (
                    <span>{`: ${item.action.pattern} @ ${item.action.url}`}</span>
                  )}
                  {item.type === "web_search_call" && item.action.type === "search" && (
                    <span>
                      {": "}
                      {item.action.query}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
    </div>
  )
})

export default AiThinkingPanel
