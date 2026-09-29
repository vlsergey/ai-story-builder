import { trpc } from "@/ipcClient"
import useAlert from "@/native/useAlert"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui-components/accordion"
import { Button } from "@/ui-components/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui-components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/ui-components/field"
import { Switch } from "@/ui-components/switch"
import { zodResolver } from "@hookform/resolvers/zod"
import type { WizardField } from "@shared/project-template"
import { buildFormSchema } from "@shared/project-template-form"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { ControllableWizardFieldRenderer } from "./create-wizard/TemplateSettingsWizardPage"

/** A parameter of the template an update may change, with the value the project holds. */
interface TemplateParameter {
  field: WizardField
  value: string
}

/** New values for some of the parameters, by field name. */
type ParameterChanges = Record<string, string | number>

const sameChanges = (a: ParameterChanges, b: ParameterChanges) => JSON.stringify(a) === JSON.stringify(b)

export default function UpdateFromTemplateDialog() {
  const { t } = useTranslation(["projects", "translation"])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [removeMissingEdges, setRemoveMissingEdges] = useState(false)
  const removeEdgesFieldId = useId()
  const removeEdgesDescriptionId = useId()
  const [changes, setChanges] = useState<ParameterChanges>({})
  // The form starts from the values the project holds, as the first analysis
  // of this opening reports them; later analyses carry the changes.
  const [projectParameters, setProjectParameters] = useState<TemplateParameter[] | null>(null)

  const trpcUtils = trpc.useUtils()
  const analyzeQuery = trpc.project.analyzeTemplateUpdate.useQuery(
    { parameters: changes },
    { enabled: isDialogOpen, retry: false, keepPreviousData: true },
  )
  const applyMutation = trpc.project.applyTemplateUpdate.useMutation().mutateAsync

  useEffect(() => {
    if (isDialogOpen && projectParameters === null && analyzeQuery.data && !analyzeQuery.isPreviousData) {
      setProjectParameters(analyzeQuery.data.parameters)
    }
  }, [isDialogOpen, projectParameters, analyzeQuery.data, analyzeQuery.isPreviousData])

  // A value the field does not allow blocks the apply: it would apply the last
  // valid one, not what the dialog shows.
  const [parametersInvalid, setParametersInvalid] = useState(false)
  const handleParametersChange = useCallback((next: ParameterChanges | null) => {
    setParametersInvalid(next === null)
    if (next !== null) setChanges((previous) => (sameChanges(previous, next) ? previous : next))
  }, [])

  const alert = useAlert()

  trpc.native.menuState.backToFrontMenuActions.subscribe.useSubscription(undefined, {
    onData(action) {
      if (action === "update-from-template") {
        // Every opening starts from what the project holds.
        setChanges({})
        setParametersInvalid(false)
        setProjectParameters(null)
        setIsDialogOpen(true)
      }
    },
  })

  const handleApply = useCallback(async () => {
    setIsApplying(true)
    try {
      await applyMutation({ removeMissingEdges, parameters: changes })
      setIsDialogOpen(false)
      await trpcUtils.plan.invalidate()
      await trpcUtils.project.invalidate()
    } catch (err) {
      await alert(err instanceof Error ? err.message : String(err))
    } finally {
      setIsApplying(false)
    }
  }, [alert, trpcUtils, removeMissingEdges, changes])

  const analysis = analyzeQuery.data
  const error = analyzeQuery.error
  const isLoading = analyzeQuery.isLoading
  const hasNodeChanges =
    !!analysis &&
    (analysis.updatedNodes.length > 0 ||
      analysis.retypedNodes.length > 0 ||
      analysis.retypeBlocked.length > 0 ||
      analysis.newNodes.length > 0 ||
      analysis.newEdges.length > 0 ||
      analysis.removedEdges.length > 0)
  // A changed parameter is worth applying on its own: the project keeps it.
  const hasChanges = hasNodeChanges || Object.keys(changes).length > 0

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
          {projectParameters && projectParameters.length > 0 && (
            <TemplateParameters parameters={projectParameters} onChange={handleParametersChange} />
          )}
          {analysis && !hasChanges && <div>{t("UpdateFromTemplateDialog.noChanges")}</div>}
          {analysis && hasNodeChanges && (
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
                {analysis.retypedNodes.length > 0 && (
                  <AccordionItem value="retyped">
                    <AccordionTrigger>
                      {t("UpdateFromTemplateDialog.retypedNodesHeader", { count: analysis.retypedNodes.length })}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-4 list-disc">
                        {analysis.retypedNodes.map((n) => (
                          <li key={n.title}>
                            {t("UpdateFromTemplateDialog.retypedNode", { title: n.title, from: n.from, to: n.to })}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {analysis.retypeBlocked.length > 0 && (
                  <AccordionItem value="retype-blocked">
                    <AccordionTrigger>
                      {t("UpdateFromTemplateDialog.retypeBlockedHeader", { count: analysis.retypeBlocked.length })}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-4 list-disc">
                        {analysis.retypeBlocked.map((n) => (
                          <li key={n.title}>
                            {t("UpdateFromTemplateDialog.retypeBlockedNode", {
                              title: n.title,
                              from: n.from,
                              to: n.to,
                              reason: n.reason,
                            })}
                          </li>
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
                {analysis.removedEdges.length > 0 && (
                  <AccordionItem value="removed-edges">
                    <AccordionTrigger>
                      {t("UpdateFromTemplateDialog.removedEdgesHeader", { count: analysis.removedEdges.length })}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-4 list-disc">
                        {analysis.removedEdges.map((e) => (
                          <li key={`${e.sourceTitle}->${e.targetTitle}:${e.type}`}>
                            {e.sourceTitle} → {e.targetTitle}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
              {analysis.removedEdges.length > 0 && (
                <Field orientation="responsive">
                  <FieldContent>
                    <FieldLabel htmlFor={removeEdgesFieldId}>
                      {t("UpdateFromTemplateDialog.removeMissingEdgesLabel")}
                    </FieldLabel>
                    <FieldDescription id={removeEdgesDescriptionId}>
                      {t("UpdateFromTemplateDialog.removeMissingEdgesDescription")}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    aria-describedby={removeEdgesDescriptionId}
                    id={removeEdgesFieldId}
                    checked={removeMissingEdges}
                    onCheckedChange={setRemoveMissingEdges}
                  />
                </Field>
              )}
              <div className="text-muted-foreground">{t("UpdateFromTemplateDialog.disclaimer")}</div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isApplying}>
            {t("UpdateFromTemplateDialog.cancel")}
          </Button>
          <Button type="button" onClick={handleApply} disabled={isApplying || !hasChanges || parametersInvalid}>
            {isApplying ? t("UpdateFromTemplateDialog.applying") : t("UpdateFromTemplateDialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const NO_ADVICE: Record<string, string> = {}

/**
 * The template's parameters an update may change, starting from the values
 * the project holds. Reports the ones set to another value, or null while
 * some field holds a value it does not allow.
 */
function TemplateParameters({
  parameters,
  onChange,
}: {
  parameters: TemplateParameter[]
  onChange: (changes: ParameterChanges | null) => void
}) {
  const { t } = useTranslation(["projects", "translation"])
  const schema = useMemo(() => buildFormSchema(parameters.map((p) => p.field)), [parameters])
  const held = useMemo(() => Object.fromEntries(parameters.map((p) => [p.field.name, p.value])), [parameters])
  const form = useForm({ resolver: zodResolver(schema), mode: "onChange", defaultValues: held })
  const values = useWatch({ control: form.control })

  useEffect(() => {
    const checked = schema.safeParse(values)
    if (!checked.success) {
      onChange(null)
      return
    }
    const changed = Object.entries(checked.data).filter(([name, value]) => String(value) !== held[name])
    onChange(Object.fromEntries(changed) as ParameterChanges)
  }, [values, schema, held, onChange])

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>{t("UpdateFromTemplateDialog.parametersHeader")}</FieldLegend>
        <FieldDescription>{t("UpdateFromTemplateDialog.parametersDescription")}</FieldDescription>
        {parameters.map(({ field: wizardField }) => (
          <Controller
            key={wizardField.name}
            name={wizardField.name}
            control={form.control}
            render={({ field, fieldState }) => (
              <ControllableWizardFieldRenderer
                wizardField={wizardField}
                field={field}
                fieldState={fieldState}
                settings={undefined}
                adviceContext={NO_ADVICE}
              />
            )}
          />
        ))}
      </FieldSet>
    </FieldGroup>
  )
}
