import React from "react"
import { trpc } from "../ipcClient"
import { BookOpen, ChevronRight, ExternalLink, FileText, FolderOpen, Plus, X, XIcon } from "lucide-react"
import { Button } from "../ui-components/button"
import { Input } from "../ui-components/input"
import { useLocale } from "../lib/locale"
import { ButtonGroup } from "@/ui-components/button-group"

/** Returns the project display name from a full filesystem path: basename without extension. */
function projectDisplayName(fullPath: string): string {
  const base = fullPath.split(/[/\\]/).pop() ?? fullPath
  return base.replace(/\.[^.]+$/, "")
}

function CreateNewForm() {
  const [name, setName] = React.useState("MyProject")
  const [textLanguage, setTextLanguage] = React.useState("ru-RU")
  const [busy, setBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const utils = trpc.useUtils().project
  const createProject = trpc.project.create.useMutation({
    onSettled() {
      utils.invalidate()
    },
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setCreateError(null)
    try {
      await createProject.mutateAsync({ name, text_language: textLanguage })
    } catch (err) {
      setCreateError(`Create failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            placeholder="Project name"
          />
          <Button type="submit" disabled={busy} size="sm" className="shrink-0">
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
        <select
          value={textLanguage}
          onChange={(e) => setTextLanguage(e.target.value)}
          className="h-8 text-sm rounded-md border border-input bg-background px-3 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="ru-RU">Русский (ru-RU)</option>
          <option value="en-US">English (en-US)</option>
        </select>
      </form>
      {createError && <p className="mt-2 text-xs text-destructive">{createError}</p>}
    </div>
  )
}

export default function StartScreen() {
  const { t } = useLocale()

  const recent = trpc.project.recent.useQuery().data
  const projectsData = trpc.project.files.useQuery().data

  const openFolder = trpc.project.openFolder.useMutation().mutateAsync

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

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* ── Left panel: branding + recent projects ── */}
      <aside className="w-80 shrink-0 flex flex-col border-r border-border bg-muted/20">
        {/* App identity */}
        <div className="px-5 pt-8 pb-5 border-b border-border">
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
        <div className="flex-1 overflow-y-auto py-4">
          <p className="px-5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("start.recent")}
          </p>

          {openProject.isError && (
            <div className="mx-3 mb-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              {`${openProject.error}`}
            </div>
          )}

          {(recent || []).length === 0 ? (
            <p className="px-5 py-2 text-xs text-muted-foreground">{t("start.no_recent")}</p>
          ) : (
            <ButtonGroup orientation="vertical" className="w-full">
              {(recent || []).map((r) => (
                <ButtonGroup key={r} orientation="horizontal" className="w-full group/recent-item">
                  <Button
                    className="flex-1 min-w-0"
                    variant="ghost"
                    onClick={() => openRecent(r)}>
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                    <span className="flex-1 truncate text-left">{projectDisplayName(r)}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover/recent-item:opacity-100 transition-opacity" />
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={(e) => removeRecent(e, r)}
                    title="Remove from list"
                    className="shrink-0 opacity-0 group-hover/recent-item:opacity-100 transition-opacity">
                      <XIcon className="h-3 w-3" />
                  </Button>
                </ButtonGroup>
              ))}
            </ButtonGroup>
          )}
        </div>
      </aside>

      {/* ── Right panel: create new + projects folder ── */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {/* Page header */}
        <div className="px-10 pt-10 pb-8">
          <h2 className="text-2xl font-bold tracking-tight">{t("start.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Start a new story or continue an existing one.</p>
        </div>

        <div className="px-10 pb-10 flex flex-col gap-8 max-w-lg">
          {/* ── Create new project ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Plus className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold">{t("start.create")}</h3>
            </div>
            <CreateNewForm />
          </section>

          <div className="border-t border-border" />

          {/* ── Projects folder ── */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <FolderOpen className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold">{t("start.projects_folder")}</h3>
              <button
                type="button"
                onClick={() => openFolder()}
                title="Open in file manager"
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Show in explorer
              </button>
            </div>

            {projectsData && (
              <p className="text-[11px] text-muted-foreground mb-3 pl-6 break-all">{projectsData.dir}</p>
            )}

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
          </section>
        </div>
      </main>
    </div>
  )
}
