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

// Mock theme provider used by AppMenu
vi.mock('../lib/theme/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() })
}));

/**
 * DockviewReact mock that actually renders panel components into the DOM.
 *
 * Key behaviours that mirror the real library:
 *  - addGroup() with no arguments creates the root group (OK).
 *  - addGroup({ id }) with only an id (no direction / referenceGroup) throws,
 *    exactly like the real dockview (it falls into the AbsolutePosition branch
 *    and calls directionToPosition(undefined) which throws).
 *  - addPanel() renders the corresponding component so tests can query the DOM.
 *  - fromJSON() restores panels so the normalisation test can verify rendering.
 */
vi.mock('dockview', () => {
  return {
    DockviewReact: ({ components, watermarkComponent: Watermark, onReady, onDidLayoutChange }) => {
      const [renderedPanels, setRenderedPanels] = React.useState([]);

      React.useEffect(() => {
        const panelList = [];

        const api = {
          fromJSON: vi.fn((layout) => {
            if (layout && layout.panels) {
              panelList.length = 0;
              Object.values(layout.panels).forEach(p => {
                panelList.push({
                  id: p.id,
                  component: p.component || p.contentComponent,
                  title: p.title,
                });
              });
              setRenderedPanels([...panelList]);
            }
          }),

          toJSON: vi.fn(() => ({
            grid: { root: { type: 'branch', data: [], size: 0 }, width: 0, height: 0, orientation: 'HORIZONTAL' },
            panels: panelList.reduce((acc, p) => ({ ...acc, [p.id]: p }), {}),
          })),

          clear: vi.fn(() => {
            panelList.length = 0;
            setRenderedPanels([]);
          }),

          addPanel: vi.fn((conf) => {
            panelList.push(conf);
            setRenderedPanels([...panelList]);
            if (onDidLayoutChange) onDidLayoutChange();
            return {};
          }),

          // Mirror the real library: passing any options object without
          // direction/referenceGroup/referencePanel ends up calling
          // directionToPosition(undefined) which throws.
          addGroup: vi.fn((conf) => {
            if (conf !== undefined && !conf.direction && !conf.referenceGroup && !conf.referencePanel) {
              throw new Error(`dockview: invalid direction '${conf.direction}'`);
            }
            return { id: `mock-group-${panelList.length}` };
          }),
        };

        if (onReady) onReady({ api });
      }, []);

      return (
        <div data-testid="dockview">
          {renderedPanels.length === 0 && Watermark && <Watermark />}
          {renderedPanels.map(conf => {
            const Comp = components[conf.component];
            return Comp ? (
              <div key={conf.id} data-testid={`panel-${conf.id}`}>
                <Comp api={{ title: conf.title }} params={{}} />
              </div>
            ) : null;
          })}
        </div>
      );
    },
  };
});

const mockProps = {
  localeStrings: {},
  onClose: vi.fn(),
};

describe('Layout', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', (url, opts) => {
      if (opts && opts.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      // null → restoreLayout falls through to setupDefaultLayout
      return Promise.resolve({ json: () => Promise.resolve(null) });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders without crashing', () => {
    expect(() => render(<Layout {...mockProps} />)).not.toThrow();
  });

  it('includes cache-control on layout fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ json: () => Promise.resolve(null) });
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

  it('saves layout to database when reset action is invoked', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(<Layout {...mockProps} />);

    // Wait for default panels to load so toJSON returns non-empty panels
    await screen.findByTestId('panel-lore-panel');

    // open View menu and click Reset layouts
    fireEvent.pointerDown(screen.getByText('View'));
    fireEvent.click(screen.getByText('View'));
    const resetItem = await screen.findByText('Reset layouts');
    fireEvent.click(resetItem);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/settings/layout',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('default layout: lore, plan, cards panels appear; no editor panel in center', async () => {
    vi.stubGlobal('fetch', (url, opts) => {
      if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ json: () => Promise.resolve(null) }); // null → setupDefaultLayout
    });

    render(<Layout {...mockProps} />);

    // All three side panels must appear in the DOM
    await screen.findByTestId('panel-lore-panel');
    await screen.findByTestId('panel-plan-panel');
    await screen.findByTestId('panel-cards-panel');

    // Their contents are rendered
    expect(screen.getByTestId('folder-section')).toBeInTheDocument();
    expect(screen.getByTestId('plan-section')).toBeInTheDocument();
    expect(screen.getByText('Cards')).toBeInTheDocument();

    // Center stays empty — no editor panel added by default
    expect(screen.queryByTestId('panel-editor-panel')).not.toBeInTheDocument();
  });

  it('normalizes contentComponent → component when loading saved layout', async () => {
    const saved = {
      grid: { root: { type: 'branch', data: [], size: 0 }, width: 0, height: 0, orientation: 'HORIZONTAL' },
      panels: {
        p1: { id: 'p1', contentComponent: 'lore', title: 'foo' },
      },
    };
    vi.stubGlobal('fetch', (url, opts) => {
      if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ json: () => Promise.resolve(saved) });
    });

    render(<Layout {...mockProps} />);

    // Panel p1 must render using the lore component (FolderSection)
    await screen.findByTestId('panel-p1');
    expect(screen.getByTestId('folder-section')).toBeInTheDocument();
  });
});
