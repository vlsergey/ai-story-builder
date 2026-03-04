import React, { useRef, useEffect } from 'react'
import { DockviewReact, DockviewDefaultTab } from 'dockview'
import { useTheme } from '../lib/theme/theme-provider'

// Import the dockview styles
import 'dockview/dist/styles/dockview.css'

// Local small wrappers to keep import cycles simple
import LoreSection from './LoreSection'
import PlanSection from './PlanSection'
import LoreEditor from './LoreEditor'
import PlanEditor from './PlanEditor'
import { LoreNode, PlanNodeTree, LocaleStrings, ThemePreference } from '../types/models'
import { EditorSettingsProvider } from '../lib/editor-settings'
import { LoreSettingsProvider } from '../lib/lore-settings'

/**
 * Shown in any empty group (including the center on startup).
 * Not a panel — cannot be moved or closed.
 * Disappears automatically when a real panel is added to the group.
 */
const WelcomeWatermark = () => (
  <div className="flex items-center justify-center h-full bg-background select-none">
    <span className="text-3xl font-bold text-muted-foreground/40 tracking-wide">
      AI Story Builder
    </span>
  </div>
)

/**
 * Layout component provides the main 4-pane dock-like layout:
 * - Left (30%): Lore and Plan tree
 * - Center (40%): Story editor / MD editor
 * - Right (30%): Cards definitions / list
 * - Bottom: Logs / AI & Billing panel
 *
 * This implementation uses dockview for a fully dockable, resizable interface.
 * Each area is a placeholder component with descriptive comments to make extension straightforward.
 */
export default function Layout({ localeStrings, onClose, initialLayout }: { localeStrings: LocaleStrings; onClose: () => void; initialLayout: unknown | null }) {
  // Use local state to track selected lore item and pass dbPath into child components
  const [selectedLoreNode, setSelectedLoreNode] = React.useState<LoreNode | null>(null)
  const [selectedPlanNode, setSelectedPlanNode] = React.useState<PlanNodeTree | null>(null)
  const dockviewRef = useRef<any>(null)
  const { setPreference } = useTheme()

  /** Opens (or activates) a lore-editor tab for the given node in the center group. */
  function openLoreEditor(node: LoreNode) {
    const api = dockviewRef.current
    if (!api) return
    const panelId = `lore-editor-${node.id}`
    // If already open, just bring it to the front
    const existing = api.getPanel(panelId)
    if (existing) { existing.api.setActive(); return }
    // Find best target group: existing editor panels > empty (watermark) group > no ref
    const editorGroup: any =
      api.groups.find((g: any) => g.panels.some((p: any) => p.id.startsWith('lore-editor-'))) ??
      api.groups.find((g: any) => g.panels.length === 0)
    api.addPanel({
      id: panelId,
      component: 'lore-editor',
      tabComponent: 'loreEditorTab',
      title: node.name,
      params: { nodeId: node.id },
      ...(editorGroup ? { position: { referenceGroup: editorGroup } } : {}),
    })
  }

  // Load saved theme preference from the project settings
  useEffect(() => {
    fetch('/api/settings/ui_theme')
      .then(res => res.json())
      .then((data: { value?: string }) => { if (data.value) setPreference(data.value) })
      .catch(() => {})
  }, [])

  // helper to massage storage format into the version expected by dockview
  const normalizeLayout = (layout: any) => {
    if (!layout || typeof layout !== 'object') return layout
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

  // Lock every group that has no panels (watermark groups).
  // Called after any layout application — both fromJSON() and setupDefaultLayout() —
  // so old saved layouts without the locked flag are also covered.
  const lockWatermarkGroups = () => {
    if (!dockviewRef.current) return
    for (const group of dockviewRef.current.groups) {
      if (group.panels.length === 0) {
        // Prevent the group from being a drag/drop target
        group.locked = 'no-drop-target'
        // Hide the tab bar entirely — it contains dv-void-container/dv-draggable
        // which lets the user drag the group even when there are no panels
        group.header.hidden = true
      }
    }
  }

  // helper used after ready or when project is loaded
  const restoreLayout = async () => {
    if (!dockviewRef.current) {
      console.log('[Layout] restoreLayout: ref not ready, skipping')
      return
    }
    const savedLayout = initialLayout != null ? initialLayout : await loadLayoutFromDatabase()
    console.log('[Layout] restoreLayout: loaded layout', {
      hasGrid: (savedLayout as any)?.grid ? 'yes' : 'no',
      panelsCount: (savedLayout as any)?.panels ? Object.keys((savedLayout as any).panels).length : 0,
      rawSize: JSON.stringify(savedLayout).length
    })
    if (savedLayout) {
      try {
        dockviewRef.current.fromJSON(normalizeLayout(savedLayout))
        console.log('[Layout] restoreLayout: applied to dockview')
      } catch (e) {
        console.warn('Failed to restore layout', e)
        setupDefaultLayout()
      }
    } else {
      console.log('[Layout] restoreLayout: no saved layout, using defaults')
      setupDefaultLayout()
    }
    lockWatermarkGroups()
  }

  // Load layout only once when component mounts (project is already open in server)
  useEffect(() => {
    console.log('[Layout] component mounted, restoring layout')
    restoreLayout()
  }, [])

  // Load layout from database
  const loadLayoutFromDatabase = async () => {
    try {
      const layout = await fetch(
        '/api/settings/layout',
        { cache: 'no-store' }
      ).then(res => res.json())
      return layout
    } catch (e) {
      console.error('Failed to load layout from database:', e)
      return null
    }
  }

  // Save layout to database
  const saveLayoutToDatabase = async (layout: any) => {
    // guard: don't save empty layouts (can happen during React cleanup or Strict Mode double-invoke)
    const panelsCount = layout?.panels ? Object.keys(layout.panels).length : 0
    if (panelsCount === 0) {
      console.warn('[Layout] saveLayoutToDatabase: skipping empty layout')
      return
    }

    try {
      console.log('[Layout] saveLayoutToDatabase: saving', { panelsCount, size: JSON.stringify(layout).length })
      await fetch('/api/settings/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout })
      })
    } catch (e) {
      console.error('Failed to save layout to database:', e)
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

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  const setupDefaultLayout = () => {
    if (!dockviewRef.current) return

    dockviewRef.current.clear()

    // Create the center group with no arguments — passing any options object (even just {id})
    // triggers the AbsolutePosition branch which requires a direction and throws without one.
    // The empty group shows WelcomeWatermark; panels added with a direction create their own groups.
    const centerGroup = dockviewRef.current.addGroup()

    dockviewRef.current.addPanel({
      id: 'lore-panel',
      component: 'lore',
      tabComponent: 'nonClosableTab',
      title: 'Lore',
      position: { referenceGroup: centerGroup, direction: 'left' },
      minimumWidth: 200,
    })

    dockviewRef.current.addPanel({
      id: 'plan-panel',
      component: 'plan',
      tabComponent: 'nonClosableTab',
      title: 'Plan',
      position: { referencePanel: 'lore-panel', direction: 'below' },
      minimumHeight: 150,
    })

    dockviewRef.current.addPanel({
      id: 'cards-panel',
      component: 'cards',
      tabComponent: 'nonClosableTab',
      title: 'Cards',
      position: { referenceGroup: centerGroup, direction: 'right' },
      minimumWidth: 200,
    })
  }

  const onReady = (event: any) => {
    console.log('[Layout] onReady: dockview api available')
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

  // Native-menu IPC listener.
  // Actions: 'reset-layouts', 'close-project', 'set-theme:<value>'
  // A ref keeps the latest function references accessible inside the one-time effect.
  const menuActionsRef = useRef({ handleResetLayouts, onClose, setPreference })
  menuActionsRef.current = { handleResetLayouts, onClose, setPreference }

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onMenuAction((action: string) => {
      if (action === 'reset-layouts') {
        menuActionsRef.current.handleResetLayouts()
      } else if (action === 'close-project') {
        menuActionsRef.current.onClose()
      } else if (action.startsWith('set-theme:')) {
        menuActionsRef.current.setPreference(action.slice(10) as ThemePreference)
      }
    })
    return () => { window.electronAPI?.removeMenuActionListeners() }
  }, [])

  // Custom tab components without close buttons for non-closable panels
  const NonClosableTab = (props: any) => {
    return (
      <div className="dv-default-tab">
        <div className="dv-default-tab-content">{props.params?.title || props.api?.title}</div>
      </div>
    );
  };

  // Tab for lore-editor panels. Wraps DockviewDefaultTab but overrides the close
  // action so that closing the last panel in a group keeps the group alive (shows
  // watermark) instead of collapsing the layout.
  const LoreEditorTab = (props: any) => {
    const closeAction = () => {
      const group = props.api?.group
      if (group && group.panels.length === 1) {
        // Last panel — remove without destroying the group
        ;(props.containerApi as any).component.removePanel(
          (props.api as any).panel,
          { removeEmptyGroup: false }
        )
      } else {
        props.api?.close()
      }
    }
    return <DockviewDefaultTab {...props} closeActionOverride={closeAction} />
  };

  const components = {
    lore: () => (
      <div className="p-2 h-full">
        <LoreSection
          onSelectLoreNode={node => { setSelectedPlanNode(null); setSelectedLoreNode(node) }}
          onOpenLoreNode={openLoreEditor}
        />
      </div>
    ),
    'lore-editor': (props: any) => (
      <LoreEditor nodeId={props.params?.nodeId} panelApi={props.api} />
    ),
    plan: () => (
      <div className="p-2 h-full">
        <PlanSection
          onSelectNode={node => { setSelectedLoreNode(null); setSelectedPlanNode(node) }}
        />
      </div>
    ),
    editor: () => (
      <div className="p-2 h-full">
        {selectedLoreNode ? (
          <LoreEditor loreNode={selectedLoreNode} />
        ) : selectedPlanNode ? (
          <PlanEditor planNode={selectedPlanNode} />
        ) : (
          <div className="flex items-center justify-center h-full select-none">
            <span className="text-3xl font-bold text-muted-foreground/40 tracking-wide">
              AI Story Builder
            </span>
          </div>
        )}
      </div>
    ),
    cards: () => (
      <div className="p-2 h-full">
        <h3 className="font-semibold mb-2">Cards</h3>
        <p className="text-muted-foreground">Card definitions and values panel placeholder.</p>
      </div>
    )
  };

  const tabComponents = {
    nonClosableTab: NonClosableTab,
    loreEditorTab: LoreEditorTab,
  };

  // Prevent non-lore-editor panels from being dropped into the editor group.
  // The editor group is identified by already containing at least one lore-editor panel.
  const handleWillDrop = (event: any) => {
    const targetGroup = event.group
    if (!targetGroup) return
    const isEditorGroup = targetGroup.panels.some(
      (p: any) => p.id.startsWith('lore-editor-')
    )
    if (!isEditorGroup) return
    const draggedPanelId = event.getData?.()?.panelId ?? event.panel?.id
    if (!draggedPanelId?.startsWith('lore-editor-')) {
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
