import { useLocale } from "@/lib/locale";
import { AiEngineConfig, getAiEngineConfigSchema } from "@shared/ai-engine-config";
import { AGE_RATING_INFO, AGE_RATING_ORDER, AiEngineDefinition, CAPABILITY_KEYS } from "@shared/ai-engines";
import { useCallback, useEffect } from "react";
import { trpc } from "@/ipcClient";
import AiGenerationSettingsFieldGroup from "./AiGenerationSettingsFieldGroup";
import { FieldGroup, FieldLegend, FieldSet } from "./ui/field";
import { Button } from "@/components/ui/button"
import { RefreshCw } from 'lucide-react'
import { ScrollArea } from "./ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Separator } from "./ui/separator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import debounce from "lodash/debounce";
import AiEngineField from "./AiEngineField";
import { Textarea } from "@/components/ui/textarea";

interface AiEngineConfigEditorProps {
    active: boolean,
    engine: AiEngineDefinition,
    value: AiEngineConfig,
    onChange: (value: AiEngineConfig) => void,
}

export default function AiEngineConfigEditor({active, engine, value, onChange}: AiEngineConfigEditorProps) {
    const { t } = useLocale()

    const maxRatingIdx = AGE_RATING_ORDER.indexOf(engine.ageRating)
    const supportedRatings = AGE_RATING_ORDER.slice(0, maxRatingIdx + 1)

    const engineModels: string[] = value.available_models ?? []
    const engineNotes = t(`engine.${engine.id}.notes`, '')

    const formSchema = getAiEngineConfigSchema(engine)

    const form = useForm<AiEngineConfig>({
        resolver: zodResolver(formSchema),
        defaultValues: value,
    })

    // Reset form when value changes (e.g., after data refetch)
    useEffect(() => {
        form.reset(value);
    }, [value, form]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const debouncedSubmit = useCallback(debounce(() => {
        form.handleSubmit(onChange)();
    }, 1000), [form, onChange]);

    useEffect(() => {
        const subscription = form.watch(debouncedSubmit);
        return () => subscription.unsubscribe();
    }, [form, debouncedSubmit]);

    const utils = trpc.useUtils()
    const { mutate: refreshEngineModels, isPending: isRefreshingModelsPending } = trpc.settings.allAiEnginesConfig.refreshEngineModels.useMutation({
        onSettled: () => utils.settings.allAiEnginesConfig.invalidate(),
    })

    const onRefreshingModels = useCallback(() => refreshEngineModels(engine.id), [engine, refreshEngineModels])
    const testMutation = trpc.ai.test.useMutation()

    return (
        <Card
            key={engine.id}
            className={`border rounded-lg p-4 ${active ? 'border-primary' : 'border-border'}`}
        >
        <CardHeader className="flex items-center gap-2 mb-4">
            <CardTitle>{t(`engine.${engine.id}.name`)}</CardTitle>
            <span className="text-xs text-muted-foreground">{t('settings.aiEngine.by')} {engine.provider}</span>
            {active && (
                <span className="text-xs text-primary font-medium">{t('settings.aiEngine.active')}</span>
            )}
            <div className="ml-auto flex gap-0.5">
                {supportedRatings.map(rating => {
                const info = AGE_RATING_INFO[rating]
                return (
                    <span
                    key={rating}
                    className="text-[10px] font-bold px-1 py-0.5 rounded"
                    style={{ backgroundColor: info.bg, color: info.fg }}
                    title={t(`ageRating.${rating}.longLabel`)}
                    >
                    {info.label}
                    </span>
                )
                })}
            </div>
        </CardHeader>
        <CardContent>

        <FieldSet>
            <FieldGroup>
                {/* Engine Settings Fields */}
                {engine.configFields.map(field => (<AiEngineField
                    engine={engine}
                    field={field}
                    formControl={form.control}
                    key={field.key}
                    orientation="vertical"
                />))}

                {/* Test button + result */}
                <div className="flex items-center gap-2 mb-4">
                <Button
                    variant="outline"
                    onClick={() => testMutation.mutate({engineId: engine.id, aiEngineConfig: value})}
                    disabled={testMutation.isPending}
                >
                    {testMutation.isPending ? t('settings.testing') : t('settings.testConnection')}
                </Button>
                {(testMutation.isError || testMutation.isSuccess) && (
                    <span
                    className={`text-xs ${(testMutation.isSuccess && testMutation.data.ok) ? 'text-green-600' : 'text-destructive'}`}
                    >
                    {testMutation.isSuccess && testMutation.data.ok
                        ? `✓ ${testMutation.data.detail}`
                        : `✗ ${testMutation.data?.detail || testMutation.error?.message || 'unknown error'}`}
                    </span>
                )}
                </div>
            </FieldGroup>
        </FieldSet>

        <Separator className="my-4"/>

        <FieldSet>
            <FieldLegend>
                <div className="flex items-center justify-between">
                    <CardTitle>{t('settings.models.title')}</CardTitle>
                    <Button variant="ghost" size="icon" onClick={onRefreshingModels} disabled={isRefreshingModelsPending}>
                        <RefreshCw className={isRefreshingModelsPending ? "animate-spin" : ""} />
                    </Button>
                </div>
            </FieldLegend>
            <FieldGroup>
                <ScrollArea className="h-28 rounded-md border">
                    <div className="p-2">
                        {!engineModels.length ? t('settings.models.none') : <span key="none"/>}
                        {engineModels.map((model) => (
                            <div key={model} className="text-sm py-1 truncate">
                                {model.replace(/^gpt:\/\/[^/]+\//, '')}
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </FieldGroup>
        </FieldSet>

        <Separator className="my-4"/>

        <FieldSet>
            <FieldLegend>{t('settings.defaultAiGenerationSettings.title')}</FieldLegend>
            <AiGenerationSettingsFieldGroup
                formControl={form.control}
                formFieldNamePrefix="defaultAiGenerationSettings."
                engineId={engine.id}
            />
        </FieldSet>

        <Separator className="my-4"/>

        <FieldSet>
          <FieldLegend>{t('settings.generateSummaryInstructions.title')}</FieldLegend>
          <FieldGroup>
            <Textarea
              {...form.register('generateSummaryInstructions')}
              placeholder={t('settings.generateSummaryInstructions.placeholder')}
              rows={4}
            />
          </FieldGroup>
        </FieldSet>

        <Separator className="my-4"/>

        <FieldSet>
            <FieldLegend>{t('settings.summaryAiGenerationSettings.title')}</FieldLegend>
            <AiGenerationSettingsFieldGroup
                formControl={form.control}
                engineId={engine.id}
                formFieldNamePrefix="summaryAiGenerationSettings."
            />
        </FieldSet>

        <Separator className="my-4"/>

        {/* Capabilities */}
        <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('settings.capabilities')}</p>
        <div className="flex flex-col gap-1.5">
            {CAPABILITY_KEYS.map(capKey => {
            const supported = engine.capabilities[capKey]
            return (
                <div key={capKey} className="flex items-start gap-2">
                <span
                    className={`text-sm leading-tight mt-0.5 ${
                    supported ? 'text-green-600' : 'text-muted-foreground/40'
                    }`}
                    aria-label={supported ? 'supported' : 'not supported'}
                >
                    {supported ? '✓' : '✗'}
                </span>
                <div>
                    <p
                    className={`text-xs font-medium leading-tight ${
                        supported ? '' : 'text-muted-foreground/60'
                    }`}
                    >
                    {t(`capability.${capKey}.label`)}
                    </p>
                    <p className="text-xs text-muted-foreground">{t(`capability.${capKey}.description`)}</p>
                </div>
                </div>
            )
            })}
        </div>
        </div>

        {/* Engine notes */}
        {engineNotes && (
        <p className="text-xs text-muted-foreground mt-3 italic">{engineNotes}</p>
        )}
        </CardContent>
    </Card>
    )

}