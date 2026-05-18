import AiThinkingPanel, { type AiThinkingPanelHandle } from "@/ai/AiThinkingPanel"
import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { Textarea } from "@/ui-components/textarea"
import type { AiEngineConfig } from "@shared/ai-engine-config"
import type { AiEngineKey } from "@shared/ai-engines"
import type { WizardAdviceField } from "@shared/project-template"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

interface AdviceFieldProps {
  wizardField: WizardAdviceField
  htmlId: string
  /** Engine selected on the AI-select wizard page, or null if user skipped it. */
  engineId: AiEngineKey | null
  /** Engine config for the selected engine (api_key, model, default settings). */
  aiEngineConfig: AiEngineConfig | undefined
  /** Current wizard form values — the prompt template is rendered against these. */
  wizardData: Record<string, string>
}

type Mode = "idle" | "dispatched" | "thinking" | "streaming" | "done" | "error"

/**
 * Read-only wizard field that asks the configured LLM for a recommendation
 * based on previous wizard answers (synopsis, age rating, etc.).
 *
 * UX mirrors the plan-node regeneration panel: an empty area, then live
 * reasoning chips, then streaming answer text. Without a configured engine
 * we render a disabled hint instead of the button — there's nothing to call.
 */
export default function AdviceField({ wizardField, htmlId, engineId, aiEngineConfig, wizardData }: AdviceFieldProps) {
  const { t } = useTranslation("create-wizard")
  const [text, setText] = useState("")
  const [mode, setMode] = useState<Mode>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const aiThinkingPanelRef = useRef<AiThinkingPanelHandle>(null)

  const canAsk = !!engineId && !!aiEngineConfig

  trpc.ai.generateAdvice.useSubscription(
    {
      engineId: engineId as AiEngineKey,
      aiEngineConfig: aiEngineConfig ?? {},
      promptTemplate: wizardField.prompt,
      systemPromptTemplate: wizardField.systemPrompt,
      wizardData,
    },
    {
      enabled: mode === "dispatched" || mode === "thinking" || mode === "streaming",
      onData: (event) => {
        switch (event.type) {
          case "event": {
            const streamEvent = event.event as ResponseStreamEvent
            switch (streamEvent.type) {
              case "response.output_text.delta":
                setMode("streaming")
                setText((prev) => prev + streamEvent.delta)
                break
              case "response.output_item.added":
              case "response.output_item.done":
              case "response.reasoning_summary_text.delta":
                setMode((m) => (m === "streaming" ? m : "thinking"))
                aiThinkingPanelRef.current?.onEvent(streamEvent)
                break
              default:
                aiThinkingPanelRef.current?.onEvent(streamEvent)
            }
            break
          }
          case "data":
            // Final accumulated text — guard against deltas missing edge cases.
            setText(event.data)
            break
          case "completed":
            setMode("done")
            aiThinkingPanelRef.current?.onComplete()
            break
        }
      },
      onError: (err) => {
        console.error("[AdviceField] subscription error:", err)
        setErrorMessage(err.message ?? String(err))
        setMode("error")
        aiThinkingPanelRef.current?.onComplete()
      },
    },
  )

  const handleAsk = () => {
    setText("")
    setErrorMessage(null)
    aiThinkingPanelRef.current?.onComplete()
    setMode("dispatched")
  }

  return (
    <div className="flex flex-col gap-2">
      {canAsk ? (
        <Button
          type="button"
          variant="secondary"
          onClick={handleAsk}
          disabled={mode === "dispatched" || mode === "thinking" || mode === "streaming"}
          className="self-start"
        >
          {wizardField.buttonLabel}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t("advice.engine-not-configured")}</p>
      )}
      <div className={mode === "dispatched" || mode === "thinking" ? "" : "hidden"}>
        <AiThinkingPanel ref={aiThinkingPanelRef} className="text-muted-foreground" />
      </div>
      <Textarea
        id={htmlId}
        readOnly
        value={text}
        placeholder={wizardField.placeholder}
        className="w-full max-h-64 overflow-y-auto"
        rows={6}
      />
      {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
    </div>
  )
}
