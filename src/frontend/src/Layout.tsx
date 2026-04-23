import { useRef, useEffect, useCallback } from "react"
import {
  DockviewReact,
  DockviewDefaultTab,
  type DockviewReadyEvent,
  type DockviewApi,
  type DockviewPanelApi,
  type DockviewGroupPanel,
} from "dockview"
import { trpc } from "./ipcClient"
import LoreSection from "./lore/LoreSection"
import LoreEditor from "./lore/LoreEditor"
import PlanNodeEditor from "./plan/editors/PlanNodeEditor"
import PlanGraph from "./plan/plan-graph/PlanGraph"
import SettingsPanel from "./settings/SettingsPanel"
import AiBillingPanel from "./ai/AiBillingPanel"
import RegenerationPanel from "./plan/RegenerationPanel"
import type { LoreNodeRow } from "@shared/lore-node"
import { EditorSettingsProvider } from "./settings/editor-settings"
import { LoreSettingsProvider } from "./settings/lore-settings"
import { OPEN_PLAN_NODE_EDITOR_EVENT, type OpenPlanNodeEditorDetail } from "./lib/plan-graph-events"
import type { PlanNodeRow } from "@shared/plan-graph"

import "dockview/dist/styles/dockview.css"

/**
 * Shown in any empty group (including the center on startup).
 * Not a panel — cannot be moved or closed.
 * Disappears automatically when a real panel is added to the group.
 */
const WelcomeWatermark = () => (
  <div className="flex items-center justify-center h-full bg-background select-none">
    <span className="text-3xl font-bold text-muted-foreground/40 tracking-wide">AI Story Builder</span>
  </div>
)

export default function Layout() {
  const dockviewRef = useRef<DockviewApi>(null)

  /** Opens (or activates) the AI Playground singleton tab in the editor group. */
  function openAiPlayground() {
    const api = dockviewRef.current
    if (!api) return
    const existing = api.getPanel("ai-playground")
    if (existing) {
      existing.api.setActive()
      return
    }
    const editorGroup = findEditorGroup(api)
    api.addPanel({
      id: "ai-playground",
      component: "ai-playground",
      tabComponent: "editorTab",
      title: "AI Playground",
      ...(editorGroup ? { position: { referenceGroup: editorGroup } } : {}),
    })
  }

  /** Opens (or activates) the Settings singleton tab in the editor group. */
  function openSettings() {
    const api = dockviewRef.current
    if (!api) return
    const existing = api.getPanel("settings")
    if (existing) {
      existing.api.setActive()
      return
    }
    const editorGroup = findEditorGroup(api)
    api.addPanel({
      id: "settings",
      component: "settings",
      tabComponent: "editorTab",
      title: "Settings",
      ...(editorGroup ? { position: { referenceGroup: editorGroup } } : {}),
    })
  }

  /** Opens (or activates) a lore-editor tab for the given node in the center group. */
  function openLoreEditor(node: LoreNodeRow) {
    const api = dockviewRef.current
    if (!api) return
    const panelId = `lore-editor-${node.id}`
    // If already open, just bring it to the front
    const existing = api.getPanel(panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    const editorGroup = findEditorGroup(api)
    api.addPanel({
      id: panelId,
      component: "lore-editor",
      tabComponent: "editorTab",
      title: node.title,
      params: { nodeId: node.id },
      ...(editorGroup ? { position: { referenceGroup: editorGroup } } : {}),
    })
  }

  /** Opens (or activates) a plan-node-editor tab for the given node. */
  const openPlanNodeEditor = useCallback((node: PlanNodeRow) => {
    const api = dockviewRef.current
    if (!api) return
    const panelId = `plan-node-editor-${node.id}`
    const existing = api.getPanel(panelId)
    if (existing) {
      existing.api.setActive()
      return
    }
    const editorGroup = findEditorGroup(api)
    api.addPanel({
      id: panelId,
      component: "plan-node-editor",
      tabComponent: "editorTab",
      title: node.title,
      params: { nodeId: node.id },
      ...(editorGroup ? { position: { referenceGroup: editorGroup } } : {}),
    })
  }, [])

  const newLoreItem = trpc.lore.create.useMutation()

  /** Creates a new blank child node under the given parent, then opens it in LoreEditor. */
  async function openLoreWizard(node: LoreNodeRow) {
    try {
      const { id } = await newLoreItem.mutateAsync({ parent_id: node.id, name: "New lore item" })
      openLoreEditor({ id, title: "New lore item", parent_id: node.id } as LoreNodeRow)
    } catch {
      /* ignore */
    }
  }

  // Listen for open-plan-node-editor events from the PlanGraph canvas
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenPlanNodeEditorDetail>).detail
      openPlanNodeEditor(detail.node)
    }
    window.addEventListener(OPEN_PLAN_NODE_EDITOR_EVENT, handler)
    return () => window.removeEventListener(OPEN_PLAN_NODE_EDITOR_EVENT, handler)
  }, [openPlanNodeEditor])

  // Lock every group that has no panels (watermark groups).
  // Called after any layout application — both fromJSON() and setupDefaultLayout() —
  // so old saved layouts without the locked flag are also covered.
  const lockWatermarkGroups = useCallback(() => {
    if (!dockviewRef.current) return
    for (const group of dockviewRef.current.groups) {
      if (group.panels.length === 0) {
        // Prevent the group from being a drag/drop target
        group.locked = "no-drop-target"
        // Hide the tab bar entirely — it contains dv-void-container/dv-draggable
        // which lets the user drag the group even when there are no panels
        group.header.hidden = true
      }
    }
  }, [])

  const layoutFromSettings = trpc.settings.layout.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  }).data

  const setupDefaultLayout = useCallback(() => {
    if (!dockviewRef.current) return

    dockviewRef.current.clear()

    // Create a center group for the plan graph
    const centerGroup = dockviewRef.current.addGroup()

    // Add lore tree to the left
    dockviewRef.current.addPanel({
      id: "lore-panel",
      component: "lore",
      tabComponent: "nonClosableTab",
      title: "Lore",
      position: { referenceGroup: centerGroup, direction: "left" },
      minimumWidth: 200,
    })

    // Add plan-graph panel to the center group
    dockviewRef.current.addPanel({
      id: "plan-graph",
      component: "plan-graph",
      tabComponent: "permanentTab",
      title: "Plan",
      position: { referenceGroup: centerGroup },
    })

    dockviewRef.current.addPanel({
      id: "cards-panel",
      component: "cards",
      tabComponent: "nonClosableTab",
      title: "Cards",
      position: { referenceGroup: centerGroup, direction: "right" },
      minimumWidth: 200,
    })

    dockviewRef.current.addPanel({
      id: "billing-panel",
      component: "billing",
      tabComponent: "nonClosableTab",
      title: "AI Billing",
      position: { referencePanel: "cards-panel", direction: "below" },
      minimumHeight: 100,
    })

    dockviewRef.current.addPanel({
      id: "regeneration-panel",
      component: "regeneration",
      tabComponent: "nonClosableTab",
      title: "Generation Progress",
      position: { referencePanel: "billing-panel", direction: "below" },
      minimumHeight: 150,
    })
  }, [])

  // helper used after ready or when project is loaded
  const restoreLayout = useCallback(async () => {
    if (!dockviewRef.current) return
    const savedLayout = layoutFromSettings
    if (savedLayout) {
      try {
        dockviewRef.current.fromJSON(normalizeLayout(savedLayout))
      } catch (e) {
        console.warn("Failed to restore layout", e)
        setupDefaultLayout()
      }
    } else {
      setupDefaultLayout()
    }
    lockWatermarkGroups()
  }, [layoutFromSettings, setupDefaultLayout, lockWatermarkGroups])

  // Load layout only once when component mounts (project is already open in server)
  useEffect(() => {
    restoreLayout()
  }, [restoreLayout])

  const setLayoutInDb = trpc.settings.layout.set.useMutation()

  // Save layout to database
  const saveLayoutToDatabase = async (layout: any) => {
    // guard: don't save empty layouts (can happen during React cleanup or Strict Mode double-invoke)
    const panelsCount = layout?.panels ? Object.keys(layout.panels).length : 0
    if (panelsCount === 0) return

    try {
      await setLayoutInDb.mutateAsync(layout)
    } catch (e) {
      console.error("Failed to save layout to database:", e)
    }
  }

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Note: beforeunload is unreliable—in dev mode React can unmount/remount components
      // causing this to fire with invalid state. Layout is now only explicitly saved when:
      // - user resets layout (handleResetLayouts)
      // - layout change events fire (handleLayoutChange)
      // - Never implicitly on page unload
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  const onReady = (event: DockviewReadyEvent) => {
    dockviewRef.current = event.api
    // Subscribe to layout changes via the api (not a JSX prop)
    event.api.onDidLayoutChange(handleLayoutChange)
    // When a panel is added to a group, show that group's tab bar and allow drops.
    // dockview fires onDidAddPanel with the panel itself (not { panel: ... }).
    event.api.onDidAddPanel((panel: any) => {
      const group = panel?.group
      if (!group) return
      if (group.header?.hidden) group.header.hidden = false
      if (group.locked) group.locked = false
    })
    // When a panel is removed, re-lock any groups that are now empty
    event.api.onDidRemovePanel(lockWatermarkGroups)
    // try to restore a saved layout once the api is available
    restoreLayout()
  }

  // reset the layout back to defaults (invoked by native menu via IPC)
  const handleResetLayouts = () => {
    if (dockviewRef.current) {
      setupDefaultLayout()
      // save immediately so db stays in sync
      const layoutState = dockviewRef.current.toJSON()
      saveLayoutToDatabase(layoutState)
    }
  }

  const handleLayoutChange = () => {
    // Save layout state to database when layout changes
    if (dockviewRef.current) {
      const layoutState = dockviewRef.current.toJSON()
      saveLayoutToDatabase(layoutState)
    }
  }

  const projectUtils = trpc.useUtils().project
  const closeProject = trpc.project.close.useMutation({
    onSettled() {
      projectUtils.invalidate()
    },
  })

  // Native-menu IPC listener.
  // Actions: 'reset-layouts', 'close-project', 'set-theme:<value>'
  // Note: 'set-locale:*' is handled in LocaleProvider so it works on the start screen too.
  // A ref keeps the latest function references accessible inside the one-time effect.
  const menuActionsRef = useRef({ handleResetLayouts, openSettings, closeProject })
  menuActionsRef.current = { handleResetLayouts, openSettings, closeProject }

  trpc.native.menuState.backToFrontMenuActions.subscribe.useSubscription(undefined, {
    onData(action) {
      if (action === "open-settings") {
        menuActionsRef.current.openSettings()
      } else if (action === "reset-layouts") {
        menuActionsRef.current.handleResetLayouts()
      } else if (action === "close-project") {
        menuActionsRef.current.closeProject.mutate()
      }
    },
  })

  // Custom tab components without close buttons for non-closable panels
  const NonClosableTab = (props: any) => {
    return (
      <div className="dv-default-tab">
        <div className="dv-default-tab-content">{props.params?.title || props.api?.title}</div>
      </div>
    )
  }

  // Permanent tab — like NonClosableTab, no close button; used for plan-graph
  const PermanentTab = (props: any) => {
    return (
      <div className="dv-default-tab">
        <div className="dv-default-tab-content">{props.params?.title || props.api?.title}</div>
      </div>
    )
  }

  // Tab for editor panels. Wraps DockviewDefaultTab but overrides the close
  // action so that closing the last panel in a group keeps the group alive (shows
  // watermark) instead of collapsing the layout.
  const EditorTab = (props: any) => {
    const closeAction = () => {
      const group = props.api?.group
      if (group && group.panels.length === 1) {
        // Last panel — remove without destroying the group
        props.containerApi.component.removePanel(props.api.panel, { removeEmptyGroup: false })
      } else {
        props.api?.close()
      }
    }
    return <DockviewDefaultTab {...props} closeActionOverride={closeAction} />
  }

  const components = {
    lore: () => (
      <div className="p-2 h-full">
        <LoreSection
          onSelectLoreNode={() => {}}
          onOpenLoreNode={openLoreEditor}
          onOpenLoreWizard={(node) => void openLoreWizard(node)}
        />
      </div>
    ),
    "lore-editor": (props: { api: DockviewPanelApi; params: { nodeId: number } }) => (
      <LoreEditor nodeId={props.params?.nodeId} panelApi={props.api} />
    ),
    "plan-graph": () => <PlanGraph />,
    "plan-node-editor": (props: { api: DockviewPanelApi; params: { nodeId: number } }) => (
      <PlanNodeEditor nodeId={props.params?.nodeId} panelApi={props.api} />
    ),
    cards: () => (
      <div className="p-2 h-full">
        <h3 className="font-semibold mb-2">Cards</h3>
        <p className="text-muted-foreground">Card definitions and values panel placeholder.</p>
      </div>
    ),
    settings: () => <SettingsPanel />,
    billing: () => <AiBillingPanel />,
    regeneration: (props: { api: DockviewPanelApi }) => <RegenerationPanel panelApi={props.api} />,
  }

  const tabComponents = {
    nonClosableTab: NonClosableTab,
    permanentTab: PermanentTab,
    editorTab: EditorTab,
  }

  // Prevent sidebar/utility panels (lore, cards) from being dropped into the editor group.
  const handleWillDrop = (event: any) => {
    const targetGroup = event.group
    if (!targetGroup) return
    const isEditorGroup = targetGroup.panels.some(
      (p: any) =>
        p.id.startsWith("lore-editor-") ||
        p.id.startsWith("plan-node-editor-") ||
        p.id === "plan-graph" ||
        p.id === "settings" ||
        p.id === "ai-playground",
    )
    if (!isEditorGroup) return
    const draggedPanelId = event.getData?.()?.panelId ?? event.panel?.id
    const isEditorPanel =
      draggedPanelId?.startsWith("lore-editor-") ||
      draggedPanelId?.startsWith("plan-node-editor-") ||
      draggedPanelId === "plan-graph" ||
      draggedPanelId === "settings" ||
      draggedPanelId === "ai-playground"
    if (!isEditorPanel) {
      event.preventDefault()
    }
  }

  return (
    <LoreSettingsProvider>
      <EditorSettingsProvider>
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0 bg-background overflow-hidden">
            <DockviewReact
              components={components}
              tabComponents={tabComponents}
              watermarkComponent={WelcomeWatermark}
              onReady={onReady}
              onWillDrop={handleWillDrop}
              disableFloatingGroups={false}
              disableDnd={false}
              className="dockview-theme"
            />
          </div>
          <div className="flex h-12 border-t border-border p-2 items-center bg-background justify-center">
            <p className="text-muted-foreground text-sm">Project open</p>
          </div>
        </div>
      </EditorSettingsProvider>
    </LoreSettingsProvider>
  )
}

// helper to massage storage format into the version expected by dockview
function normalizeLayout(layout: any) {
  if (!layout || typeof layout !== "object") return layout
  if (layout.panels) {
    Object.values(layout.panels).forEach((p: any) => {
      // dockview.toJSON currently emits "contentComponent"; fromJSON
      // expects "component". copy over if missing.
      if (p.contentComponent && !p.component) {
        p.component = p.contentComponent
      }
    })
  }
  return layout
}
/**
 * Returns the group that should receive editor-type panels (lore-editor, plan-node-editor, settings).
 * Prefers an existing editor group; falls back to the plan-graph group; then an empty group.
 */
function findEditorGroup(api: DockviewApi): DockviewGroupPanel | undefined {
  return (
    api.groups.find((g: any) =>
      g.panels.some(
        (p: any) =>
          p.id.startsWith("lore-editor-") ||
          p.id.startsWith("plan-node-editor-") ||
          p.id === "settings" ||
          p.id === "ai-playground" ||
          p.id === "plan-graph",
      ),
    ) ?? api.groups.find((g: any) => g.panels.length === 0)
  )
}
