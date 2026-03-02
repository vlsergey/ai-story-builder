import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Layout from '../components/Layout';

// Mock the API functions
vi.mock('../../src/api', () => ({
  saveLayoutSettings: vi.fn().mockResolvedValue({ success: true }),
  getLayoutSettings: vi.fn().mockResolvedValue({
    layout: {},
    activeGroup: "group-1"
  })
}));

// Mock the child components
vi.mock('../components/LoreEditor', () => ({
  default: () => <div>Lore Editor</div>
}));

vi.mock('../components/PlanSection', () => ({
  default: () => <div>Plan Section</div>
}));

vi.mock('../components/GeneratedPartEditor', () => ({
  default: () => <div>Generated Part Editor</div>
}));

vi.mock('../components/DiffViewer', () => ({
  default: () => <div>Diff Viewer</div>
}));

// Mock dockview components, capturing onReady API
let mockPanels = {};
let mockApi = {
  fromJSON: vi.fn(),
  toJSON: vi.fn(() => ({
    grid: { root: { type: 'branch', data: [], size: 0 } },
    panels: mockPanels
  })),
  clear: vi.fn(() => {
    mockPanels = {};
  }),
  addPanel: vi.fn((conf) => {
    const panelId = conf.id || `panel-${Object.keys(mockPanels).length}`;
    mockPanels[panelId] = { 
      id: panelId, 
      component: conf.component, 
      title: conf.title 
    };
    return { /* return minimal panel object if needed */ };
  }),
};

// our Layout imports from 'dockview' which re-exports from 'dockview-core';
// we need to stub the top-level package so the component rendered in tests
// uses our mock API rather than the real library.
vi.mock('dockview-core', () => {
  const actual = vi.importActual('dockview-core');
  return {
    ...actual,
    DockviewReact: ({ children, onReady, ...props }) => {
      React.useEffect(() => {
        if (onReady) {
          onReady({ api: mockApi });
        }
      }, [onReady]);
      return <div data-testid="dockview" {...props}>{children}</div>;
    },
    DockviewReadyEvent: vi.fn(),
    PanelCollection: ({ children }) => <div>{children}</div>,
    PanelParameters: vi.fn(),
  };
});

vi.mock('dockview', () => {
  const actual = vi.importActual('dockview-core');
  return {
    ...actual,
    DockviewReact: ({ children, onReady, ...props }) => {
      React.useEffect(() => {
        if (onReady) {
          onReady({ api: mockApi });
        }
      }, [onReady]);
      return <div data-testid="dockview" {...props}>{children}</div>;
    },
    DockviewReadyEvent: vi.fn(),
    PanelCollection: ({ children }) => <div>{children}</div>,
    PanelParameters: vi.fn(),
  };
});

vi.mock('dockview-core/dist/cjs/dockview/components/titlebar/defaultTitlebar', () => ({
  DefaultTab: ({ canClose }) => (
    <div>
      Tab
      {canClose !== false && <button data-testid="close-button">X</button>}
    </div>
  )
}));

vi.mock('dockview-core/dist/cjs/dockview/components/tab/defaultTab', () => ({
  DefaultTab: () => <div>Tab</div>
}));

// Mock the theme provider
vi.mock('../../src/lib/theme/theme-provider', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn()
  })
}));

const mockProps = {
  projectPath: '/test/path',
  localeStrings: {},
  onClose: vi.fn()
};

describe('Layout', () => {
  beforeEach(() => {
    // reset mock state
    mockPanels = {};
    // stub global fetch for layout load/save
    vi.stubGlobal('fetch', (url, opts) => {
      if (opts && opts.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      // GET layout
      return Promise.resolve({
        json: () => Promise.resolve({})
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders without crashing', () => {
    expect(() => {
      render(<Layout {...mockProps} />);
    }).not.toThrow();
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

    // open menu and click reset
    fireEvent.pointerDown(screen.getByText('View'));
    fireEvent.click(screen.getByText('View'));
    const resetItem = await screen.findByText('Reset layouts');
    fireEvent.click(resetItem);

    // component will also perform a GET to load layout (which includes the ?db= query),
    // but the reset handler itself should fire a POST to the base endpoint.
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/settings/layout',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('normalizes panel keys when loading saved layout', async () => {
    // arrange: fetch returns layout with contentComponent names
    const saved = {
      grid: { root: { type: 'branch', data: [], size: 0 }, width: 0, height: 0, orientation: 'HORIZONTAL' },
      panels: {
        'p1': { id: 'p1', contentComponent: 'lore', title: 'foo' }
      }
    }
    // override fetch to return the specific layout; this stub doesn't handle POST
    vi.stubGlobal('fetch', (url, opts) => {
      if (opts && opts.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      // verify that layout loads are also using no-store
      expect(opts && opts.cache).toBe('no-store');
      return Promise.resolve({ json: () => Promise.resolve(saved) });
    })

    render(<Layout {...mockProps} />);
    // wait for any restoration attempt
    await waitFor(() => {
      expect(mockApi.fromJSON).toHaveBeenCalled();
    });

    // locate the call where panels exist (we may receive an empty layout first)
    const layoutCalls = mockApi.fromJSON.mock.calls.map(c => c[0]);
    const withPanels = layoutCalls.find(l => l && l.panels && l.panels.p1);
    expect(withPanels).toBeTruthy();
    expect(withPanels.panels['p1'].component).toBe('lore');
  });
});