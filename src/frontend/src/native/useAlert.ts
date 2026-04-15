import { trpc } from "@/ipcClient"
import { useLocale } from "@/lib/locale"
import { useMemo } from "react"

export default function useAlert() {
  const { t } = useLocale()
  const mutation = trpc.native.showMessageBox.useMutation()

  const result = useMemo(
    () =>
      async (messageTranslationKey: string, titleTranslationKey: string = "native.alert.title") => {
        const result = await mutation.mutateAsync({
          message: t(messageTranslationKey),
          type: "warning",
          title: t(titleTranslationKey),
        })
        return result.response === 0
      },
    [mutation.mutateAsync, t],
  )

  return result
}
