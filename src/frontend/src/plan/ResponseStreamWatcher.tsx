import TransWrapper from "@/i18n/TransWrapper"
import { trpc } from "@/ipcClient"
import { Field, FieldContent } from "@/ui-components/field"
import { Textarea } from "@/ui-components/textarea"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { type FollowedStreams, followStreams, NO_STREAMS, pruneStreams } from "./followed-stream"

interface ResponseStreamWatcherProps {
  className?: string
  /** The nodes running now, as `runningKeyOf` names them: a stream of any other node has ended. */
  running?: ReadonlySet<string>
}

/** The text the model is writing now: of several streams, the one followed. */
export default function ResponseStreamWatcher({ className, running }: ResponseStreamWatcherProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [streams, setStreams] = useState<FollowedStreams>(NO_STREAMS)

  trpc.plan.nodes.aiGenerate.subscribeToResponseStreamEvents.useSubscription(undefined, {
    onData(event) {
      setStreams((state) => followStreams(state, event))
    },
  })
  useEffect(() => {
    if (running) setStreams((state) => pruneStreams(state, running))
  }, [running])
  const content = streams.followed === null ? "" : (streams.texts[streams.followed] ?? "")

  // biome-ignore lint: scroll on content change
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    })
  }, [content])

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
        value={content}
      />
    </Field>
  )
}
