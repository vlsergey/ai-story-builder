import { trpc } from "@/ipcClient"
import useAlert from "@/native/useAlert"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui-components/accordion"
import { Button } from "@/ui-components/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui-components/dialog"
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"

export default function UpdateFromTemplateDialog() {
  const { t } = useTranslation(["projects", "translation"])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  const trpcUtils = trpc.useUtils()
  const analyzeQuery = trpc.project.analyzeTemplateUpdate.useQuery(undefined, { enabled: isDialogOpen, retry: false })
  const applyMutation = trpc.project.applyTemplateUpdate.useMutation().mutateAsync

  const alert = useAlert()

  trpc.native.menuState.backToFrontMenuActions.subscribe.useSubscription(undefined, {
    onData(action) {
      if (action === "update-from-template") {
        setIsDialogOpen(true)
      }
    },
  })

  const handleApply = useCallback(async () => {
    setIsApplying(true)
    try {
      await applyMutation()
      setIsDialogOpen(false)
      await trpcUtils.plan.invalidate()
      await trpcUtils.project.invalidate()
    } catch (err) {
      await alert(err instanceof Error ? err.message : String(err))
    } finally {
      setIsApplying(false)
    }
  }, [alert, trpcUtils])

  const analysis = analyzeQuery.data
  const error = analyzeQuery.error
  const isLoading = analyzeQuery.isLoading
  const hasChanges =
    !!analysis && (analysis.updatedNodes.length > 0 || analysis.newNodes.length > 0 || analysis.newEdges.length > 0)

  return (
    <Dialog open={isDialogOpen} onOpenChange={(value) => setIsDialogOpen(value)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {analysis
              ? t("UpdateFromTemplateDialog.title", { file: analysis.templateFile })
              : t("UpdateFromTemplateDialog.titleLoading")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          {isLoading && <div>{t("UpdateFromTemplateDialog.analysing")}</div>}
          {error && <div className="text-destructive">{error.message}</div>}
          {analysis && !hasChanges && <div>{t("UpdateFromTemplateDialog.noChanges")}</div>}
          {analysis && hasChanges && (
            <>
              <div>{t("UpdateFromTemplateDialog.unchangedCount", { count: analysis.unchangedCount })}</div>
              <Accordion type="multiple" className="w-full">
                {analysis.updatedNodes.length > 0 && (
                  <AccordionItem value="updated">
                    <AccordionTrigger>
                      {t("UpdateFromTemplateDialog.updatedNodesHeader", { count: analysis.updatedNodes.length })}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-4 list-disc">
                        {analysis.updatedNodes.map((n) => (
                          <li key={n.title}>{n.title}</li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {analysis.newNodes.length > 0 && (
                  <AccordionItem value="new-nodes">
                    <AccordionTrigger>
                      {t("UpdateFromTemplateDialog.newNodesHeader", { count: analysis.newNodes.length })}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-4 list-disc">
                        {analysis.newNodes.map((n) => (
                          <li key={n.title}>{n.title}</li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {analysis.newEdges.length > 0 && (
                  <AccordionItem value="new-edges">
                    <AccordionTrigger>
                      {t("UpdateFromTemplateDialog.newEdgesHeader", { count: analysis.newEdges.length })}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-4 list-disc">
                        {analysis.newEdges.map((e) => (
                          <li key={`${e.sourceTitle}->${e.targetTitle}:${e.type}`}>
                            {e.sourceTitle} → {e.targetTitle}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
              <div className="text-muted-foreground">{t("UpdateFromTemplateDialog.disclaimer")}</div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isApplying}>
            {t("UpdateFromTemplateDialog.cancel")}
          </Button>
          <Button type="button" onClick={handleApply} disabled={isApplying || !hasChanges}>
            {isApplying ? t("UpdateFromTemplateDialog.applying") : t("UpdateFromTemplateDialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
