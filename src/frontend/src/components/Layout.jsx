import React, { useRef, useEffect } from 'react'
import { DockviewReact } from 'dockview'

// Import the dockview styles
import 'dockview/dist/styles/dockview.css'

// Local small wrappers to keep import cycles simple
import FolderSection from './FolderSection'
import PlanSection from './PlanSection'
import LoreEditor from './LoreEditor'
import PlanEditor from './PlanEditor'
import AppMenu from './AppMenu'

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
export default function Layout({ localeStrings, onClose }) {
  // Use local state to track selected lore item and pass dbPath into child components
  const [selectedLoreItem, setSelectedLoreItem] = React.useState(null)
  const [selectedPlanNode, setSelectedPlanNode] = React.useState(null)
  const dockviewRef = useRef(null)

  // helper to massage storage format into the version expected by dockview
  const normalizeLayout = (layout) => {
    if (!layout || typeof layout !== 'object') return layout
    if (layout.panels) {
      Object.values(layout.panels).forEach(p => {
        // dockview.toJSON currently emits "contentComponent"; fromJSON
        // expects "component". copy over if missing.
        if (p.contentComponent && !p.component) {
          p.component = p.contentComponent
        }
      })
    }
    return layout
  }

  // helper used after ready or when project is loaded
  const restoreLayout = async () => {
    if (!dockviewRef.current) {
      console.log('[Layout] restoreLayout: ref not ready, skipping')
      return
    }
    console.log('[Layout] restoreLayout: loading from db')
    const savedLayout = await loadLayoutFromDatabase()
    console.log('[Layout] restoreLayout: loaded layout', {
      hasGrid: savedLayout?.grid ? 'yes' : 'no',
      panelsCount: savedLayout?.panels ? Object.keys(savedLayout.panels).length : 0,
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
  const saveLayoutToDatabase = async (layout) => {
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

    // Clear any existing panels
    dockviewRef.current.clear()

    // Add the main panels
    const lorePanel = dockviewRef.current.addPanel({
      id: 'lore-panel',
      component: 'lore',
      tabComponent: 'nonClosableTab',
      title: 'Lore',
      position: { direction: 'left' },
      minimumWidth: 200,
    })

    const planPanel = dockviewRef.current.addPanel({
      id: 'plan-panel',
      component: 'plan',
      tabComponent: 'nonClosableTab',
      title: 'Plan',
      position: { direction: 'bottom', referencePanel: 'lore-panel' },
      minimumHeight: 150,
    })

    const editorPanel = dockviewRef.current.addPanel({
      id: 'editor-panel',
      component: 'editor',
      title: 'Editor',
      position: { direction: 'right', referencePanel: 'lore-panel' },
    })

    const cardsPanel = dockviewRef.current.addPanel({
      id: 'cards-panel',
      component: 'cards',
      tabComponent: 'nonClosableTab',
      title: 'Cards',
      position: { direction: 'right', referencePanel: 'editor-panel' },
      minimumWidth: 200,
    })
  }

  const onReady = (event) => {
    console.log('[Layout] onReady: dockview api available')
    dockviewRef.current = event.api
    // try to restore a saved layout once the api is available
    restoreLayout()
  }

  // reset the layout back to defaults (used by the View menu)
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

  // Custom tab components without close buttons for non-closable panels
  const NonClosableTab = (props) => {
    return (
      <div className="dv-default-tab">
        <div className="dv-default-tab-content">{props.params?.title || props.api?.title}</div>
      </div>
    );
  };

  const components = {
    lore: () => (
      <div className="p-2 h-full">
        <FolderSection
          onSelectLoreItem={node => { setSelectedPlanNode(null); setSelectedLoreItem(node) }}
        />
      </div>
    ),
    plan: () => (
      <div className="p-2 h-full">
        <PlanSection
          onSelectNode={node => { setSelectedLoreItem(null); setSelectedPlanNode(node) }}
        />
      </div>
    ),
    editor: () => (
      <div className="p-2 h-full">
        {selectedLoreItem ? (
          <LoreEditor loreItem={selectedLoreItem} />
        ) : selectedPlanNode ? (
          <PlanEditor planNode={selectedPlanNode} />
        ) : (
          <div className="text-muted-foreground flex items-center justify-center h-full">
            Select a lore file or a plan node to edit.
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
  };

  return (
    <div className="flex flex-col h-full">
      <AppMenu onResetLayouts={handleResetLayouts} onClose={onClose} />
      <div className="flex-1 bg-background">
        <DockviewReact
          components={components}
          tabComponents={tabComponents}
          onReady={onReady}
          onDidLayoutChange={handleLayoutChange}
          disableFloatingGroups={false}
          disableDnd={false}
          disableResizing={false}
          className="dockview-theme"
        />
      </div>
      <div className="flex h-12 border-t border-border p-2 items-center bg-background">
        <div className="w-48 flex items-center space-x-2">
          <button
            className="px-3 py-1 rounded text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80"
            onClick={onClose}
          >
            Close Project
          </button>
        </div>
        <div className="flex-1 flex justify-center">
        </div>
        <div className="w-48 text-right">
          <p className="text-muted-foreground text-sm">Project open</p>
        </div>
      </div>
    </div>
  )
}
