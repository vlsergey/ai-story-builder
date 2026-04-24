import TransWrapper from "@/i18n/TransWrapper"
import { trpc } from "@/ipcClient"
import { Field, FieldContent } from "@/ui-components/field"
import { Textarea } from "@/ui-components/textarea"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

interface ResponseStreamWatcherProps {
  className?: string
}

interface LastNodeAndContentPath {
  nodeId: number
  contentPath: (number | string)[]
  content: string
}

export default function ResponseStreamWatcher({ className }: ResponseStreamWatcherProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [state, setState] = useState<LastNodeAndContentPath>({
    nodeId: 0,
    contentPath: [],
    content: "",
  })

  trpc.plan.nodes.aiGenerate.subscribeToResponseStreamEvents.useSubscription(undefined, {
    onData({ nodeId, contentPath, event }) {
      const needReset = state.nodeId !== nodeId || !areArraysEqual(state.contentPath, contentPath)
      if (event.type === "response.output_text.delta") {
        if (needReset) {
          setState({ nodeId, contentPath, content: event.delta })
        } else {
          setState((state) => ({ ...state, content: state.content + event.delta }))
        }
      } else {
        if (needReset) {
          setState({ nodeId, contentPath, content: "" })
        }
      }
    },
  })

  // biome-ignore lint: scroll on content change
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    })
  }, [state.content])

  return (
    <Field className={className}>
      <FieldContent>
        <TransWrapper i18nKey="ResponseStreamWatcher.label" />
      </FieldContent>
      <Textarea
        className="overflow-y-auto h-full resize-none"
        placeholder={t("ResponseStreamWatcher.placeholder")}
        ref={ref}
        readOnly
        value={state.content}
      />
    </Field>
  )
}

const areArraysEqual = (arr1: any[], arr2: any[]) =>
  arr1.length === arr2.length && arr1.every((val, index) => val === arr2[index])
