import { useTranslation } from "react-i18next"
import type { ParseKeys } from "i18next"
import { trpc } from "@/ipcClient"
import type { TOptions } from "i18next"
import { useMemo } from "react"

export default function useError() {
  const { t } = useTranslation()
  const showMessageBox = trpc.native.showMessageBox.useMutation()
  const writeTextToClipboard = trpc.native.clipboard.writeText.useMutation()

  const result = useMemo(
    () =>
      async (
        messageTranslationKey: ParseKeys,
        messageOptions: TOptions = {},
        titleTranslationKey: ParseKeys = "native.alert.title",
        titleOptions: TOptions = {},
      ) => {
        const result = await showMessageBox.mutateAsync({
          message: t(messageTranslationKey, messageOptions),
          type: "error",
          buttons: [t("native.showMessageBox.button.ok"), t("native.showMessageBox.button.copyToClipboard")],
          title: t(titleTranslationKey, titleOptions),
        })
        if (result.response === 0) {
          writeTextToClipboard.mutateAsync(messageTranslationKey)
        }
      },
    [t],
  )

  return result
}
