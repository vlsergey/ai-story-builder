import { useLocale } from "@/i18n/locale"
import type { TranslationKey } from "@/i18n/TranslationKey"
import { trpc } from "@/ipcClient"
import type { TOptions } from "i18next"
import { useMemo } from "react"

export default function useError() {
  const { t } = useLocale()
  const showMessageBox = trpc.native.showMessageBox.useMutation()
  const writeTextToClipboard = trpc.native.clipboard.writeText.useMutation()

  const result = useMemo(
    () =>
      async (
        messageTranslationKey: TranslationKey,
        messageOptions: TOptions = {},
        titleTranslationKey: TranslationKey = "native.alert.title",
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
    [showMessageBox.mutateAsync, t, writeTextToClipboard.mutateAsync],
  )

  return result
}
