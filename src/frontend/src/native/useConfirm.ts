import { useLocale } from "@/i18n/locale"
import type { ParseKeys } from "i18next"
import { trpc } from "@/ipcClient"
import type { TOptions } from "i18next"
import { useMemo } from "react"

export default function useConfirm() {
  const { t } = useLocale()
  const mutation = trpc.native.showMessageBox.useMutation()

  const result = useMemo(
    () =>
      async (
        messageTranslationKey: ParseKeys,
        messageTranslationOptions: TOptions = {},
        titleTranslationKey: ParseKeys = "native.confirm.title",
        okTranslationKey: ParseKeys = "native.showMessageBox.button.ok",
        cancelTranslationKey: ParseKeys = "native.showMessageBox.button.cancel",
      ) => {
        const result = await mutation.mutateAsync({
          message: t(messageTranslationKey, messageTranslationOptions),
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
