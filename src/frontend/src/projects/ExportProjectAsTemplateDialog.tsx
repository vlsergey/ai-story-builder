import { Button } from "@/ui-components/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui-components/dialog"
import { Input } from "@/ui-components/input"
import { Label } from "@/ui-components/label"
import { Switch } from "@/ui-components/switch"
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { trpc } from "../ipcClient"
import useAlert from "../native/useAlert"

export default function ExportProjectAsTemplateDialog() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const { t } = useTranslation(["projects", "translation"])
  const [filePath, setFilePath] = useState("")
  const [exportLoreStructure, setExportLoreStructure] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  trpc.native.menuState.backToFrontMenuActions.subscribe.useSubscription(undefined, {
    onData(action) {
      if (action === "export-project-as-template") {
        setIsDialogOpen(true)
      }
    },
  })

  const saveFileDialogMutation = trpc.native.saveFileDialog.useMutation().mutateAsync
  const exportProjectAsTemplateMutation = trpc.project.exportProjectAsTemplate.useMutation().mutateAsync

  const userTemplatesDir = trpc.project.getTemplatesFolders.useQuery().data?.user

  const handleBrowse = useCallback(async () => {
    const filters = [
      { name: t("fileFilterName.json" as any), extensions: ["json"] },
      { name: t("fileFilterName.*" as any), extensions: ["*"] },
    ]
    const defaultPath =
      userTemplatesDir === undefined
        ? `project-${Date.now()}.json`
        : `${userTemplatesDir.replace(/\\/g, "/")}/project-${Date.now()}.json`
    const selectedPath = await saveFileDialogMutation({ defaultPath, filters })
    if (selectedPath) {
      setFilePath(selectedPath)
    }
  }, [t, userTemplatesDir])

  const alert = useAlert()
  const handleExport = useCallback(async () => {
    if (!filePath.trim()) {
      await alert(t("ExportProjectAsTemplateDialog.error.noFilePath"))
      return
    }

    setIsExporting(true)
    try {
      await exportProjectAsTemplateMutation({
        filePath,
        exportLoreStructure,
      })
      setIsDialogOpen(false)
    } catch (error) {
      await alert(
        t("ExportProjectAsTemplateDialog.error", {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setIsExporting(false)
    }
  }, [alert, filePath, exportLoreStructure, t])

  return (
    <Dialog open={isDialogOpen} onOpenChange={(value) => setIsDialogOpen(value)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ExportProjectAsTemplateDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <Label htmlFor="filePath">{t("ExportProjectAsTemplateDialog.filePath.label")}</Label>
            <div className="flex gap-2">
              <Input
                id="filePath"
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder={t("ExportProjectAsTemplateDialog.filePath.placeholder")}
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={handleBrowse}>
                {t("ExportProjectAsTemplateDialog.browse")}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="exportLoreStructure" className="cursor-pointer">
              {t("ExportProjectAsTemplateDialog.exportLoreStructure.label")}
            </Label>
            <Switch id="exportLoreStructure" checked={exportLoreStructure} onCheckedChange={setExportLoreStructure} />
          </div>
          <div className="text-sm text-muted-foreground">
            {t("ExportProjectAsTemplateDialog.exportLoreStructure.description")}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isExporting}>
            {t("ExportProjectAsTemplateDialog.cancel")}
          </Button>
          <Button type="button" onClick={handleExport} disabled={isExporting || !filePath.trim()}>
            {isExporting ? t("ExportProjectAsTemplateDialog.exporting") : t("ExportProjectAsTemplateDialog.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
