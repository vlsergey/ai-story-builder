import React from 'react'
import { render, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@xyflow/react', () => ({
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  addEdge: vi.fn(),
  useReactFlow: () => ({ fitView: vi.fn() }),
  BackgroundVariant: { Dots: 'dots' },
}))

vi.mock('../lib/locale', () => ({
  useLocale: () => ({ locale: 'en', t: (key: string) => key }),
}))

vi.mock('../components/plan-graph/PlanTextNode', () => ({ default: () => null }))
vi.mock('../components/plan-graph/PlanLoreNode', () => ({ default: () => null }))
vi.mock('../components/plan-graph/PlanEdge', () => ({ default: () => null }))
vi.mock('../components/plan-graph/GenerateAllDialog', () => ({ default: () => null }))
vi.mock('@dagrejs/dagre', () => ({
  default: {
    graphlib: { Graph: class { setGraph() {}; setDefaultEdgeLabel() {}; setNode() {}; setEdge() {}; node() { return { x: 0, y: 0 } } } },
    layout: vi.fn(),
  }
}))

describe('PlanGraph', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ nodes: [], edges: [] }) } as Response)
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders without crashing', async () => {
    const PlanGraph = (await import('../components/PlanGraph')).default
    await act(async () => {
      render(<PlanGraph />);
    });
  })

  it('renders the ReactFlow component', async () => {
    const PlanGraph = (await import('../components/PlanGraph')).default
    let getByTestId: any;
    await act(async () => {
      const result = render(<PlanGraph />);
      getByTestId = result.getByTestId;
    });
    await waitFor(() => {
      expect(getByTestId('react-flow')).toBeInTheDocument()
    })
  })
})
