import { render } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@xyflow/react", () => ({
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  addEdge: vi.fn(),
  useReactFlow: () => ({ fitView: vi.fn() }),
  BackgroundVariant: { Dots: "dots" },
}))

vi.mock("../lib/locale", () => ({
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}))

// Mock trpc with useQuery and useMutation
const mockUseQuery = vi.fn(() => ({
  data: [],
  isLoading: false,
  isFetched: true,
  isError: false,
  error: null,
  refetch: vi.fn(),
}))
const mockUseMutation = vi.fn(() => ({
  mutate: vi.fn(() => Promise.resolve({ ok: true })),
  mutateAsync: vi.fn(() => Promise.resolve({ ok: true })),
}))

vi.mock("../ipcClient", () => ({
  trpc: {
    plan: {
      nodes: {
        findAll: { useQuery: mockUseQuery },
        delete: { useMutation: mockUseMutation },
        patch: { useMutation: mockUseMutation },
        create: { useMutation: mockUseMutation },
        batchPatch: { useMutation: mockUseMutation },
        aiGenerateSummary: { useMutation: mockUseMutation },
        aiGenerateOnly: { useMutation: mockUseMutation },
      },
      edges: {
        findAll: { useQuery: mockUseQuery },
        delete: { useMutation: mockUseMutation },
        create: { useMutation: mockUseMutation },
      },
    },
  },
}))

vi.mock("../plan/plan-graph/PlanTextNode", () => ({ default: () => null }))
vi.mock("../plan/plan-graph/PlanLoreNode", () => ({ default: () => null }))
vi.mock("../plan/plan-graph/PlanEdge", () => ({ default: () => null }))
vi.mock("../plan/GenerateAllDialog", () => ({ default: () => null }))
vi.mock("@dagrejs/dagre", () => ({
  default: {
    graphlib: {
      Graph: class {
        setGraph() {}
        setDefaultEdgeLabel() {}
        setNode() {}
        setEdge() {}
        node() {
          return { x: 0, y: 0 }
        }
      },
    },
    layout: vi.fn(),
  },
}))

describe("PlanGraph", () => {
  beforeEach(() => {
    // Ensure localStorage.getItem returns default
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => (key === "planGraph.autoLayout" ? "true" : null))
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {})
    // Ensure electronAPI.confirm returns true
    vi.spyOn(window.electronAPI, "confirm").mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders without crashing", async () => {
    const PlanGraph = (await import("../plan/plan-graph/PlanGraph")).default
    const { unmount } = render(<PlanGraph />)
    // Component should render without errors
    // No need to wait for anything because queries are mocked
    unmount()
  })

  it("renders the ReactFlow component", async () => {
    const PlanGraph = (await import("../plan/plan-graph/PlanGraph")).default
    const { getByTestId } = render(<PlanGraph />)
    // ReactFlow is mocked and should be present immediately
    expect(getByTestId("react-flow")).toBeInTheDocument()
  })
})
