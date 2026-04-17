import { trpc } from "@/ipcClient"
import { useLocale } from "@/lib/locale"
import { useMemo } from "react"

export default function useError() {
  const { t } = useLocale()
  const showMessageBox = trpc.native.showMessageBox.useMutation()
  const writeTextToClipboard = trpc.native.clipboard.writeText.useMutation()

  const result = useMemo(
    () =>
      async (message: string, titleTranslationKey: string = "native.alert.title") => {
        const result = await showMessageBox.mutateAsync({
          message: message,
          type: "error",
          buttons: [t("Close"), t("Copy to Clipboard")],
          title: t(titleTranslationKey),
        })
        if (result.response === 0) {
          writeTextToClipboard.mutateAsync(message)
        }
      },
    [showMessageBox.mutateAsync, t, writeTextToClipboard.mutateAsync],
  )

  return result
}
