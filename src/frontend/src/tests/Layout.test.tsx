import React from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Layout from '../components/Layout';
import { OPEN_PLAN_NODE_EDITOR_EVENT } from '../lib/plan-graph-events';

// Captures the onOpenLoreNode / onOpenLoreWizard callbacks so tests can trigger panel opens
let capturedOnOpenLoreNode: ((node: any) => void) | null = null
let capturedOnOpenLoreWizard: ((node: any) => void) | null = null

// Mock child components that have their own network/state dependencies
vi.mock('../components/LoreSection', () => ({
  default: (props: any) => {
    capturedOnOpenLoreNode = props.onOpenLoreNode
    capturedOnOpenLoreWizard = props.onOpenLoreWizard
    return <div data-testid="folder-section">Folder Section</div>
  }
}));

vi.mock('../components/PlanGraph', () => ({
  default: () => <div data-testid="plan-graph">Plan Graph</div>
}));

vi.mock('../components/LoreEditor', () => ({
  default: () => <div>Lore Editor</div>
}));

vi.mock('../components/PlanEditor', () => ({
  default: () => <div>Plan Editor</div>
}));

// Mock theme provider used by Layout
vi.mock('../lib/theme/theme-provider', () => ({
  useTheme: () => ({ preference: 'auto', resolvedTheme: 'github', setPreference: vi.fn() })
}));

// Mock locale context used by Layout
vi.mock('../lib/locale', () => ({
  useLocale: () => ({ locale: 'en', setLocale: vi.fn(), t: (key: string) => key }),
}));

const mockProps = {
  onClose: vi.fn(),
  initialLayout: null,
};

describe('Layout', () => {
  // Capture the IPC handler registered by the component
  let menuActionHandler: ((action: string) => void) | null = null

  beforeEach(() => {
    menuActionHandler = null
    capturedOnOpenLoreNode = null
    capturedOnOpenLoreWizard = null
    window.electronAPI = {
      onMenuAction: vi.fn((cb) => { menuActionHandler = cb; return vi.fn() }),
      sendMenuState: vi.fn(),
      showErrorDialog: vi.fn(),
      invoke: vi.fn().mockImplementation((channel: string) => {
        if (channel === 'settings:layout:get') return Promise.resolve(null)
        if (channel === 'settings:layout:save') return Promise.resolve({ ok: true })
        if (channel === 'settings:get') return Promise.resolve({ value: null })
        if (channel === 'lore:create') return Promise.resolve({ id: 99 })
        return Promise.resolve({})
      }),
      startStream: vi.fn().mockResolvedValue({ ok: true }),
      abortStream: vi.fn().mockResolvedValue({ ok: true }),
      onStreamEvent: vi.fn().mockReturnValue(vi.fn()),
      alert: vi.fn(),
      confirm: vi.fn(),
      trpc: { invoke: vi.fn() },
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).electronAPI
  });

  it('renders without crashing', async () => {
    await act(async () => {
      render(<Layout {...mockProps} />);
    });
  });

  it('loads layout via IPC on mount', async () => {
    render(<Layout {...mockProps} />);
    await waitFor(() => expect(window.electronAPI.invoke).toHaveBeenCalledWith('settings:layout:get'));
  });

  it('default layout: lore, plan-graph and cards panels render', async () => {
    render(<Layout {...mockProps} />);

    // dockview renders panel components into the DOM — verify content appears
    await waitFor(() => {
      expect(screen.getByTestId('folder-section')).toBeInTheDocument();
    });
    // Plan graph panel is now in the center
    expect(screen.getByTestId('plan-graph')).toBeInTheDocument();
    // cards panel: check unique placeholder text
    expect(screen.getByText('Card definitions and values panel placeholder.')).toBeInTheDocument();
  });

  it('registers an IPC menu-action listener on mount', async () => {
    render(<Layout {...mockProps} />);
    await waitFor(() => expect(screen.getByTestId('folder-section')).toBeInTheDocument());
    expect(window.electronAPI.onMenuAction).toHaveBeenCalled();
  });

  it('tab bar becomes visible when a lore editor is opened', async () => {
    const { container } = render(<Layout {...mockProps} />)
    await screen.findByTestId('folder-section')

    // Simulate opening a lore editor via the LoreSection callback
    const mockNode = {
      id: 42, name: 'Dragon Lore', parent_id: 1, content: null,
      position: 0, status: 'ACTIVE', to_be_deleted: 0,
      created_at: '', children: [],
    }
    act(() => { capturedOnOpenLoreNode?.(mockNode) })

    // After: a close button must appear for the new editor panel
    await waitFor(() => {
      expect(container.querySelector('.dv-default-tab-action')).toBeInTheDocument()
    })
  })

  it('lore editor created by wizard and another editor share the same group', async () => {
    const { container } = render(<Layout {...mockProps} />)
    await screen.findByTestId('folder-section')

    const mockParent = {
      id: 1, name: 'Characters', parent_id: null, content: null,
      position: 0, status: 'ACTIVE', to_be_deleted: 0,
      created_at: '', children: [],
    }
    const mockNode = {
      id: 42, name: 'Dragon Lore', parent_id: 1, content: null,
      position: 0, status: 'ACTIVE', to_be_deleted: 0,
      created_at: '', children: [],
    }

    // Open via wizard — creates node id=99, then opens lore-editor-99 in the center group
    await act(async () => { capturedOnOpenLoreWizard?.(mockParent) })
    await waitFor(() => {
      expect(screen.getByText('New lore item')).toBeInTheDocument()
    })

    // Open another editor next to it — should land in the same (center) group
    act(() => { capturedOnOpenLoreNode?.(mockNode) })
    await waitFor(() => {
      expect(container.querySelectorAll('.dv-default-tab-action').length).toBeGreaterThanOrEqual(2)
    })

    // Close the editor for mockNode — center group now holds only the wizard-created editor
    await act(async () => {
      const closeButtons = container.querySelectorAll<HTMLElement>('.dv-default-tab-action')
      fireEvent.click(closeButtons[closeButtons.length - 1])
    })

    // Re-open editor for mockNode — must land in the same group as the wizard-created editor
    act(() => { capturedOnOpenLoreNode?.(mockNode) })

    await waitFor(() => {
      expect(screen.getByText('Dragon Lore')).toBeInTheDocument()
    })

    // Both tabs must share the same .dv-groupview container
    const wizardCreatedTab = screen.getByText('New lore item')
    const editorTab = screen.getByText('Dragon Lore')
    expect(wizardCreatedTab.closest('.dv-groupview')).toBe(editorTab.closest('.dv-groupview'))
  })

  it('opens plan-node-editor panel when open-plan-node-editor event is dispatched', async () => {
    render(<Layout {...mockProps} />)
    await screen.findByTestId('plan-graph')

    act(() => {
      window.dispatchEvent(
        new CustomEvent(OPEN_PLAN_NODE_EDITOR_EVENT, { detail: { nodeId: 42 } })
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Plan node #42')).toBeInTheDocument()
    })
  })

  it('saves layout via IPC when reset-layouts IPC action fires', async () => {
    render(<Layout {...mockProps} />);

    // Wait for panels to render and handler to be registered
    await waitFor(() => expect(screen.getByTestId('folder-section')).toBeInTheDocument());
    expect(menuActionHandler).not.toBeNull();

    // Trigger 'reset-layouts' as the native menu would
    act(() => { menuActionHandler!('reset-layouts') });

    await waitFor(() => {
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'settings:layout:save',
        expect.anything()
      );
    });
  });
});
