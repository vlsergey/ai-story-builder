import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Layout from '../components/Layout';

// Mock child components that have their own network/state dependencies
vi.mock('../components/LoreSection', () => ({
  default: () => <div data-testid="folder-section">Folder Section</div>
}));

vi.mock('../components/PlanSection', () => ({
  default: () => <div data-testid="plan-section">Plan Section</div>
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

const mockProps = {
  localeStrings: {},
  onClose: vi.fn(),
  initialLayout: null,
};

describe('Layout', () => {
  // Capture the IPC handler registered by the component
  let menuActionHandler: ((action: string) => void) | null = null

  beforeEach(() => {
    menuActionHandler = null
    window.electronAPI = {
      onMenuAction: vi.fn((cb) => { menuActionHandler = cb }),
      removeMenuActionListeners: vi.fn(),
    }

    vi.stubGlobal('fetch', (_url: unknown, opts?: unknown) => {
      if (opts && (opts as RequestInit).method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      }
      // null → restoreLayout falls through to setupDefaultLayout
      return Promise.resolve({ json: () => Promise.resolve(null) } as Response);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).electronAPI
  });

  it('renders without crashing', () => {
    expect(() => render(<Layout {...mockProps} />)).not.toThrow();
  });

  it('includes cache-control on layout fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ json: () => Promise.resolve(null) } as unknown as Response);
    render(<Layout {...mockProps} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/settings/layout'),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('default layout: lore, plan and cards panels render; center stays as watermark', async () => {
    render(<Layout {...mockProps} />);

    // dockview renders panel components into the DOM — verify content appears
    await waitFor(() => {
      expect(screen.getByTestId('folder-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('plan-section')).toBeInTheDocument();
    // cards panel: check unique placeholder text (tab title also says "Cards", so getByText would be ambiguous)
    expect(screen.getByText('Card definitions and values panel placeholder.')).toBeInTheDocument();

    // Center group is empty — watermark text must be visible
    expect(screen.getByText('AI Story Builder')).toBeInTheDocument();
  });

  it('watermark group is locked and its tab bar is hidden to prevent dragging', async () => {
    const { container } = render(<Layout {...mockProps} />);

    // Wait for dockview to fully apply the default layout
    await screen.findByTestId('folder-section');

    // group.locked = 'no-drop-target' adds dv-locked-groupview to the group container
    expect(container.querySelector('.dv-locked-groupview')).toBeInTheDocument();

    // group.header.hidden = true sets display:none on dv-tabs-and-actions-container,
    // hiding the dv-void-container/dv-draggable handle that allows dragging the group
    const tabBar = container.querySelector('.dv-locked-groupview .dv-tabs-and-actions-container') as HTMLElement | null;
    expect(tabBar).toBeInTheDocument();
    expect(tabBar?.style.display).toBe('none');
  });

  it('registers an IPC menu-action listener on mount', async () => {
    render(<Layout {...mockProps} />);
    await waitFor(() => expect(screen.getByTestId('folder-section')).toBeInTheDocument());
    expect(window.electronAPI!.onMenuAction).toHaveBeenCalled();
  });

  it('saves layout to database when reset-layouts IPC action fires', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(<Layout {...mockProps} />);

    // Wait for panels to render and handler to be registered
    await waitFor(() => expect(screen.getByTestId('folder-section')).toBeInTheDocument());
    expect(menuActionHandler).not.toBeNull();

    // Trigger 'reset-layouts' as the native menu would
    act(() => { menuActionHandler!('reset-layouts') });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/settings/layout',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
