"use client"

import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/ui-components/command"
import { ExternalLinkIcon, Package, User } from "lucide-react"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"

interface TemplateComboboxProps {
  onSelect: (templateFilePath: string | null) => void
  className?: string
}

export function TemplateCommand({ className, onSelect }: TemplateComboboxProps) {
  const { t } = useTranslation("start-screen")
  const templateFolders = trpc.project.getTemplatesFolders.useQuery().data
  const templates = trpc.project.findTemplates.useQuery().data
  const openPath = trpc.native.openPath.useMutation().mutateAsync
  const mkdir = trpc.native.fs.mkdir.useMutation().mutateAsync

  const handleOpenSystemTemplatesPath = useCallback(async () => {
    const path = templateFolders?.system
    if (!path) return
    await openPath(path)
  }, [templateFolders?.system])

  const handleOpenUserTemplatesPath = useCallback(async () => {
    const path = templateFolders?.user
    if (!path) return
    await mkdir({ path: path, recursive: true })
    await openPath(path)
  }, [templateFolders?.user])

  return (
    <Command className="className">
      <CommandInput placeholder={t("TemplateCombobox.searchPlaceholder")} />
      <CommandList>
        <CommandEmpty>{t("TemplateCombobox.notFound")}</CommandEmpty>

        {/* No template option */}
        <CommandGroup>
          <CommandItem
            value="no-template"
            onSelect={() => onSelect(null)}
            className="font-medium text-muted-foreground"
          >
            {t("TemplateCombobox.noTemplate")}
          </CommandItem>
        </CommandGroup>

        {/* System templates */}
        <CommandGroup
          heading={
            <div className="flex items-end justify-between">
              <div>{t("TemplateCombobox.systemTemplates")}</div>
              <Button
                title={templateFolders?.system}
                size="xs"
                className="shrink-0 text-muted-foreground items-center"
                variant="link"
                onClick={() => handleOpenSystemTemplatesPath()}
              >
                <ExternalLinkIcon />
                {t("TemplateCombobox.openPath")}
              </Button>
            </div>
          }
        >
          {(templates || [])
            .filter((t) => t.type === "system")
            .map((template) => (
              <CommandItem
                key={template.filePath}
                value={`${template.label} ${template.description || ""}`}
                onSelect={() => onSelect(template.filePath)}
              >
                <div className="flex items-start gap-3 w-full">
                  <Package className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{template.label}</span>
                    {template.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2">{template.description}</span>
                    )}
                  </div>
                </div>
              </CommandItem>
            ))}
        </CommandGroup>

        {/* User templates */}
        <CommandGroup
          heading={
            <div className="flex items-end justify-between">
              <div>{t("TemplateCombobox.myTemplates")}</div>
              <Button
                title={templateFolders?.user}
                size="xs"
                className="shrink-0 text-muted-foreground items-center"
                variant="link"
                onClick={() => handleOpenUserTemplatesPath()}
              >
                <ExternalLinkIcon />
                {t("TemplateCombobox.openPath")}
              </Button>
            </div>
          }
        >
          {(templates || [])
            .filter((t) => t.type === "user")
            .map((template) => (
              <CommandItem
                key={template.filePath}
                value={`${template.label} ${template.description || ""}`}
                onSelect={() => onSelect(template.filePath)}
              >
                <div className="flex items-start gap-3 w-full">
                  <User className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{template.label}</span>
                    {template.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2">{template.description}</span>
                    )}
                  </div>
                </div>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
