import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { ButtonGroup } from "@/ui-components/button-group"
import { Input } from "@/ui-components/input"
import { useCallback } from "react"
import type { ControllerFieldState, ControllerRenderProps, FieldPath, FieldValues } from "react-hook-form"
import { useTranslation } from "react-i18next"

interface ControllableFilePathInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> {
  className?: string
  defaultPath?: string
  field: ControllerRenderProps<TFieldValues, TName>
  fieldState: ControllerFieldState
  openDialogOptions?: Parameters<ReturnType<(typeof trpc)["native"]["showOpenDialog"]["useMutation"]>["mutateAsync"]>[0]
  placeholder?: string
  id?: string
}

export default function ControllableFilePathInput<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  className,
  defaultPath,
  field,
  fieldState,
  openDialogOptions,
  id,
  placeholder,
}: ControllableFilePathInputProps<TFieldValues, TName>) {
  const { t } = useTranslation("ControllableFilePathInput")

  const openFileDialog = trpc.native.showOpenDialog.useMutation().mutateAsync

  const handleBrowse = useCallback(async () => {
    const actualDefaultPath = field.value != null ? field.value : defaultPath
    const result = await openFileDialog({
      ...openDialogOptions,
      defaultPath: actualDefaultPath,
    })
    if (result.canceled) return
    field.onChange(result.filePaths[0])
  }, [defaultPath, field.onChange, field.value, openDialogOptions])

  return (
    <ButtonGroup className={className}>
      <Input
        aria-invalid={fieldState.invalid}
        id={id}
        name={field.name}
        placeholder={placeholder}
        onChange={field.onChange}
        onBlur={field.onBlur}
        value={field.value || ""}
      />
      <Button type="button" onClick={handleBrowse}>
        {t("browse")}
      </Button>
    </ButtonGroup>
  )
}
