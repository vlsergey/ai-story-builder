import { useCallback } from "react"
import { trpc } from "./ipcClient"
import { useTranslation } from "react-i18next"
import useAlert from "./native/useAlert"

export default function useExportProjectAsTemplateHandler() {
  const { t } = useTranslation()
  const alert = useAlert()
  const exportProjectAsTemplateMutation = trpc.project.exportProjectAsTemplate.useMutation().mutateAsync
  const saveFileDialogMutation = trpc.native.saveFileDialog.useMutation().mutateAsync

  const handler = useCallback(async () => {
    const filters = [
      { name: t("fileFilterName.json" as any), extensions: ["json"] },
      { name: t("fileFilterName.*" as any), extensions: ["*"] },
    ]
    const defaultPath = `project-${Date.now()}.json`
    const filePath = await saveFileDialogMutation({ defaultPath, filters })
    if (!filePath) {
      // User cancelled
      return
    }
    try {
      await exportProjectAsTemplateMutation({ filePath })
    } catch (error) {
      await alert("planGraph.exportProject.error.message" as any, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [t, alert])

  trpc.native.menuState.backToFrontMenuActions.subscribe.useSubscription(undefined, {
    onData(action) {
      if (action === "export-project-as-template") {
        handler()
      }
    },
  })
}
