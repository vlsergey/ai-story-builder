import { trpc } from "@/ipcClient"
import { useLocale } from "@/lib/locale"
import type { BooleanSettingKey } from "@shared/settings"
import { useCallback, useEffect, useId, useState } from "react"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/ui-components/field"
import { Switch } from "@/ui-components/switch"

interface SettingSwitchProps {
  settingKey: BooleanSettingKey
}

export default function SettingSwitch({ settingKey }: SettingSwitchProps) {
  const { t } = useLocale()
  const idField = useId()
  const idDescription = useId()

  const [value, setValue] = useState<boolean>(false)

  // standard tRPC + TypeScript hack
  const router = trpc.settings[settingKey] as typeof trpc.settings.aiRegenerateGenerated

  const dbValue = router.get.useQuery().data
  useEffect(() => {
    if (dbValue !== undefined) {
      setValue(dbValue)
    }
  }, [dbValue])

  const mutation = router.set.useMutation()
  const handleOnChange = useCallback(
    async (value: boolean) => {
      setValue(value)
      await mutation.mutateAsync(value)
    },
    [mutation.mutateAsync],
  )

  router.subscribe.useSubscription(undefined, {
    onData(data) {
      if (data !== undefined) {
        setValue(data)
      }
    },
  })

  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldLabel htmlFor={idField}>{t(`settings.${settingKey}.label`)}</FieldLabel>
        <FieldDescription id={idDescription}>{t(`settings.${settingKey}.description`)}</FieldDescription>
      </FieldContent>
      <Switch aria-describedby={idDescription} id={idField} checked={value} onCheckedChange={handleOnChange} />
    </Field>
  )
}
