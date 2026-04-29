import { ButtonGroup } from "@/ui-components/button-group"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui-components/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/ui-components/resizable"
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  FilePlusCornerIcon,
  FileText,
  FolderOpen,
  HistoryIcon,
  XIcon,
} from "lucide-react"
import type React from "react"
import { useTranslation } from "react-i18next"
import { trpc } from "../ipcClient"
import { Button } from "../ui-components/button"
import { TemplateCommand } from "./TemplateCommand"
import { useCallback, useState } from "react"
import CreateProjectWizard from "@/projects/create-wizard/CreateProjectWizard"

/** Returns the project display name from a full filesystem path: basename without extension. */
function projectDisplayName(fullPath: string): string {
  const base = fullPath.split(/[/\\]/).pop() ?? fullPath
  return base.replace(/\.[^.]+$/, "")
}

export default function StartScreen() {
  const { t } = useTranslation("start-screen")

  const recent = trpc.project.recent.useQuery().data
  const projectsData = trpc.project.files.useQuery().data

  const openPath = trpc.native.openPath.useMutation().mutateAsync

  const utils = trpc.useUtils()
  const recentDelete = trpc.project.recentDelete.useMutation()

  async function removeRecent(e: React.MouseEvent, p: string) {
    e.stopPropagation()
    await recentDelete.mutateAsync(p)
    utils.project.recent.invalidate()
  }

  const projectUtils = trpc.useUtils().project
  const openProject = trpc.project.open.useMutation({
    onSettled() {
      projectUtils.invalidate()
    },
  })

  async function openRecent(path: string) {
    openProject.mutateAsync(path)
  }

  const [templateFilePath, setTemplateFilePath] = useState<string | null>(null)
  const [showCreateNewProjectWizard, setShowCreateNewProjectWizard] = useState(false)

  const handleSelectTemplate = useCallback((templateFilePath: string | null) => {
    setTemplateFilePath(templateFilePath)
    setShowCreateNewProjectWizard(true)
  }, [])

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-screen">
      <ResizablePanel defaultSize={50} minSize={40} className="flex flex-col">
        {/* App identity */}
        <div className="shrink-0 px-5 pt-8 pb-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">AI Story Builder</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">creative writing companion</p>
            </div>
          </div>
        </div>

        {/* Recent projects list */}
        <Card className="flex-1 m-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon />
              {t("start.recent")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex-1 overflow-y-auto">
              {openProject.isError && (
                <div className="mx-3 mb-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                  {`${openProject.error}`}
                </div>
              )}

              {(recent || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("start.no_recent")}</p>
              ) : (
                <ButtonGroup orientation="vertical" className="w-full">
                  {(recent || []).map((r) => (
                    <ButtonGroup key={r} orientation="horizontal" className="w-full group/recent-item">
                      <Button className="flex-1 min-w-0" variant="ghost" onClick={() => openRecent(r)}>
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                        <span className="flex-1 truncate text-left">{projectDisplayName(r)}</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover/recent-item:opacity-100 transition-opacity" />
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={(e) => removeRecent(e, r)}
                        title="Remove from list"
                        className="shrink-0 opacity-0 group-hover/recent-item:opacity-100 transition-opacity"
                      >
                        <XIcon className="h-3 w-3" />
                      </Button>
                    </ButtonGroup>
                  ))}
                </ButtonGroup>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Projects folder ── */}
        <Card className="flex-2 m-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen />
              {t("start.projects_folder")}
            </CardTitle>
            {projectsData && (
              <CardDescription>
                <code>{projectsData.dir}</code>
              </CardDescription>
            )}
            <CardAction>
              <Button
                type="button"
                variant="link"
                onClick={() => (projectsData !== undefined ? openPath(projectsData.dir) : {})}
              >
                <ExternalLink />
                {"Show in explorer"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!projectsData || projectsData.files.length === 0 ? (
              <p className="pl-6 text-sm text-muted-foreground">{t("start.no_files")}</p>
            ) : (
              <ul className="space-y-0.5">
                {projectsData.files.map((f) => (
                  <li key={f}>
                    <button
                      type="button"
                      onClick={() => openRecent(f)}
                      className="w-full flex items-center gap-2.5 pl-6 pr-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors text-left group"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                      <span className="truncate flex-1">{projectDisplayName(f)}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={50} minSize={30} className="flex flex-col">
        <Card className="m-2 flex-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FilePlusCornerIcon />
              {t("start.create")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateCommand onSelect={handleSelectTemplate} />
            <CreateProjectWizard
              open={showCreateNewProjectWizard}
              templateFilePath={templateFilePath}
              onOpenChange={setShowCreateNewProjectWizard}
            />
          </CardContent>
        </Card>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
