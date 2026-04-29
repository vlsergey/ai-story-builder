import { trpc } from "@/ipcClient"
import type { DefaultNamespace, ParseKeys, TOptions } from "i18next"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

export default function useAlert() {
  const { t } = useTranslation()
  const mutation = trpc.native.showMessageBox.useMutation()

  const result = useMemo(
    () =>
      async (
        message: string,
        titleTranslationKey: ParseKeys<DefaultNamespace> = "native.alert.title",
        titleOptions: TOptions = {},
      ) => {
        const result = await mutation.mutateAsync({
          message,
          type: "warning",
          title: t(titleTranslationKey, titleOptions),
        })
        return result.response === 0
      },
    [t],
  )

  return result
}
