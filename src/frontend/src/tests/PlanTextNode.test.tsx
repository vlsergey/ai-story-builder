import { render, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, afterEach } from "vitest"
import { OPEN_PLAN_NODE_EDITOR_EVENT } from "../lib/plan-graph-events"

// Mock @xyflow/react synchronously
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  NodeResizer: () => null,
  Position: { Left: "left", Right: "right" },
}))

vi.mock("../i18n/locale", () => ({
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}))

// Mock NodeTypeEditors to ensure text editor exists
vi.mock("../plan/editors/NodeTypeEditors", () => ({
  NodeTypeEditors: {
    text: () => null,
  },
}))

// The node's state comes from the iteration on display, not from its data.
vi.mock("../plan/iteration-selection", () => ({
  useNodeDisplayState: () => ({
    path: "7:2",
    state: { node_id: 5, path: "7:2", status: "GENERATED", word_count: 100 },
  }),
}))

// Mock getNodeTypeDefinition
vi.mock("@shared/node-edge-dictionary", () => ({
  getNodeTypeDefinition: vi.fn(() => ({
    allowedIncomingEdgeTypes: [],
    allowedOutgoingEdgeTypes: [],
  })),
}))

describe("PlanTextNode double-click", async () => {
  // Loaded while collecting the tests: module loading is slow on a CI runner,
  // and must not count against a test's own time.
  const { default: PlanTextNode } = await import("../plan/plan-graph/SimpleNode")

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("double-clicking the node div dispatches open-plan-node-editor", async () => {
    const dispatched: { id: number; path: string }[] = []
    const originalDispatch = window.dispatchEvent.bind(window)
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event instanceof CustomEvent && event.type === OPEN_PLAN_NODE_EDITOR_EVENT) {
        const { node, path } = (event as CustomEvent<{ node: { id: number }; path: string }>).detail
        dispatched.push({ id: node.id, path })
      }
      return originalDispatch(event)
    })

    const mockData = {
      id: 5,
      title: "Scene 1",
      type: "text" as const,
      parent_id: 7,
      onDelete: () => {},
    }

    const { container } = render(
      <PlanTextNode
        id="5"
        data={mockData as any}
        type="simple"
        selected={false}
        selectable={true}
        draggable={true}
        deletable={true}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={1}
        dragging={false}
      />,
    )

    const nodeDiv = container.querySelector("div")
    expect(nodeDiv).not.toBeNull()
    fireEvent.doubleClick(nodeDiv!)

    expect(dispatched, "opens the node in the iteration on display").toEqual([{ id: 5, path: "7:2" }])
  })
})
