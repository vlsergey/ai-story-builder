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

// Mock getNodeTypeDefinition
vi.mock("@shared/node-edge-dictionary", () => ({
  getNodeTypeDefinition: vi.fn(() => ({
    allowedIncomingEdgeTypes: [],
    allowedOutgoingEdgeTypes: [],
  })),
}))

describe("PlanTextNode double-click", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("double-clicking the node div dispatches open-plan-node-editor", async () => {
    const { default: PlanTextNode } = await import("../plan/plan-graph/SimpleNode")

    const dispatched: number[] = []
    const originalDispatch = window.dispatchEvent.bind(window)
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event instanceof CustomEvent && event.type === OPEN_PLAN_NODE_EDITOR_EVENT) {
        dispatched.push((event as CustomEvent<{ node: { id: number } }>).detail.node.id)
      }
      return originalDispatch(event)
    })

    const mockData = {
      id: 5,
      title: "Scene 1",
      type: "text" as const,
      word_count: 100,
      summary: null,
      changes_status: null,
      status: "EMPTY" as const,
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

    expect(dispatched).toContain(5)
  })
})
