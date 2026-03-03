import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Layout from '../components/Layout';

// Mock child components that have their own network/state dependencies
vi.mock('../components/FolderSection', () => ({
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

// Mock theme provider used by AppMenu and Layout
vi.mock('../lib/theme/theme-provider', () => ({
  useTheme: () => ({ preference: 'auto', resolvedTheme: 'github', setPreference: vi.fn() })
}));

const mockProps = {
  localeStrings: {},
  onClose: vi.fn(),
  initialLayout: null,
};

describe('Layout', () => {
  beforeEach(() => {
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

  it('includes the View menu trigger', () => {
    render(<Layout {...mockProps} />);
    expect(screen.getByText('View')).toBeInTheDocument();
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

  it('saves layout to database when reset action is invoked', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(<Layout {...mockProps} />);

    // Wait for panels to render before resetting
    await waitFor(() => expect(screen.getByTestId('folder-section')).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByText('View'));
    fireEvent.click(screen.getByText('View'));
    const resetItem = await screen.findByText('Reset layouts');
    fireEvent.click(resetItem);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/settings/layout',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
