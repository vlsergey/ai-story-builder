import React from 'react'
import { render, waitFor } from '@testing-library/react'
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

vi.mock('../ipcClient', () => ({
  ipcClient: {
    plan: {
      nodes: {
        getAll: { query: vi.fn(() => Promise.resolve([])) },
        delete: { mutate: vi.fn(() => Promise.resolve({ ok: true })) },
        patch: { mutate: vi.fn(() => Promise.resolve({ ok: true })) },
        create: { mutate: vi.fn(() => Promise.resolve({ id: 1 })) },
      },
      edges: {
        getAll: { query: vi.fn(() => Promise.resolve([])) },
        delete: { mutate: vi.fn(() => Promise.resolve({ ok: true })) },
        create: { mutate: vi.fn(() => Promise.resolve({ id: 1 })) },
      },
    },
  },
}))

vi.mock('../plan/plan-graph/PlanTextNode', () => ({ default: () => null }))
vi.mock('../plan/plan-graph/PlanLoreNode', () => ({ default: () => null }))
vi.mock('../plan/plan-graph/PlanEdge', () => ({ default: () => null }))
vi.mock('../plan/GenerateAllDialog', () => ({ default: () => null }))
vi.mock('@dagrejs/dagre', () => ({
  default: {
    graphlib: { Graph: class { setGraph() {} setDefaultEdgeLabel() {} setNode() {} setEdge() {} node() { return { x: 0, y: 0 } } } },
    layout: vi.fn(),
  }
}))

describe('PlanGraph', () => {
  beforeEach(() => {
    // Ensure localStorage.getItem returns default
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => 
      key === 'planGraph.autoLayout' ? 'true' : null
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
    // Ensure electronAPI.confirm returns true
    vi.spyOn(window.electronAPI, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without crashing', async () => {
    const PlanGraph = (await import('../plan/PlanGraph')).default
    const { unmount } = render(<PlanGraph />)
    // Wait for loading to finish
    await waitFor(() => {
      // Expect no error
    })
    unmount()
  })

  it('renders the ReactFlow component', async () => {
    const PlanGraph = (await import('../plan/PlanGraph')).default
    const { getByTestId } = render(<PlanGraph />)
    await waitFor(() => {
      expect(getByTestId('react-flow')).toBeInTheDocument()
    })
  })
})
