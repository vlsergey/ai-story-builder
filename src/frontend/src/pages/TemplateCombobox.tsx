"use client"

import { trpc } from "@/ipcClient"
import { cn } from "@/lib/utils"
import { Button } from "@/ui-components/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/ui-components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui-components/popover"
import { Check, ChevronsUpDown, ExternalLinkIcon, Package, User } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

interface TemplateComboboxProps {
  value: string | null // null = "no template"
  onChange: (value: string | null) => void
  className?: string
}

export function TemplateCombobox({ className, value, onChange }: TemplateComboboxProps) {
  const { t } = useTranslation("start-screen")
  const [open, setOpen] = useState(false)
  const templateFolders = trpc.project.getTemplatesFolders.useQuery().data
  const templates = trpc.project.findTemplates.useQuery().data
  const openPath = trpc.native.openPath.useMutation().mutateAsync
  const mkdir = trpc.native.mkdir.useMutation().mutateAsync

  // Find currently selected template
  const selectedTemplate = useMemo(() => (templates || []).find((t) => t.filePath === value), [templates, value])

  const handleSelect = (filePath: string | null) => {
    onChange(filePath)
    setOpen(false)
  }

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <div className="flex items-center gap-2 truncate">
            {selectedTemplate ? (
              <>
                {selectedTemplate.type === "system" ? <Package className="h-4 w-4" /> : <User className="h-4 w-4" />}
                <span className="truncate">{selectedTemplate.label}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("TemplateCombobox.noTemplate")}</span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className={cn("w-[420px] p-0", className)} avoidCollisions={false}>
        <Command>
          <CommandInput placeholder={t("TemplateCombobox.searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("TemplateCombobox.notFound")}</CommandEmpty>

            {/* No template option */}
            <CommandGroup>
              <CommandItem
                value="no-template"
                onSelect={() => handleSelect(null)}
                className="font-medium text-muted-foreground"
              >
                <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
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
                    onSelect={() => handleSelect(template.filePath)}
                  >
                    <div className="flex items-start gap-3 w-full">
                      <Package className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{template.label}</span>
                        {template.description && (
                          <span className="text-xs text-muted-foreground line-clamp-2">{template.description}</span>
                        )}
                      </div>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4 shrink-0",
                          value === template.filePath ? "opacity-100" : "opacity-0",
                        )}
                      />
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
                    onSelect={() => handleSelect(template.filePath)}
                  >
                    <div className="flex items-start gap-3 w-full">
                      <User className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{template.label}</span>
                        {template.description && (
                          <span className="text-xs text-muted-foreground line-clamp-2">{template.description}</span>
                        )}
                      </div>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4 shrink-0",
                          value === template.filePath ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </div>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
