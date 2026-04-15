import { trpc } from "@/ipcClient"
import { useLocale } from "@/lib/locale"
import { useMemo } from "react"

export default function useConfirm() {
  const { t } = useLocale()
  const mutation = trpc.native.showMessageBox.useMutation()

  const result = useMemo(
    () =>
      async (
        messageTranslationKey: string,
        titleTranslationKey: string = "native.confirm.title",
        okTranslationKey: string = "native.confirm.button.ok",
        cancelTranslationKey: string = "native.confirm.button.cancel",
      ) => {
        const result = await mutation.mutateAsync({
          message: t(messageTranslationKey),
          type: "question",
          title: t(titleTranslationKey),
          buttons: [t(okTranslationKey), t(cancelTranslationKey)],
          defaultId: 0,
          cancelId: 1,
        })
        return result.response === 0
      },
    [mutation.mutateAsync, t],
  )

  return result
}
