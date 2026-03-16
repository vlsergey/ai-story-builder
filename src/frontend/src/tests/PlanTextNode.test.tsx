import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OPEN_PLAN_NODE_EDITOR_EVENT } from '../lib/plan-graph-events'

// Provide minimal stubs for @xyflow/react used inside PlanTextNode
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Handle: () => null,
  }
})

vi.mock('../lib/locale', () => ({
  useLocale: () => ({ locale: 'en', t: (key: string) => key }),
}))

describe('PlanTextNode double-click', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('double-clicking the node div dispatches open-plan-node-editor', async () => {
    const { default: PlanTextNode } = await import('../components/plan-graph/PlanTextNode')

    const dispatched: number[] = []
    const originalDispatch = window.dispatchEvent.bind(window)
    vi.spyOn(window, 'dispatchEvent').mockImplementation((event) => {
      if (event instanceof CustomEvent && event.type === OPEN_PLAN_NODE_EDITOR_EVENT) {
        dispatched.push((event as CustomEvent<{ nodeId: number }>).detail.nodeId)
      }
      return originalDispatch(event)
    })

    const mockData = {
      id: 5,
      title: 'Scene 1',
      type: 'text' as const,
      word_count: 100,
      summary: null,
      changes_status: null,
      status: 'EMPTY' as const,
      onDelete: () => {},
    }

    const { container } = render(
      <PlanTextNode
        id="5"
        data={mockData as any}
        type="planText"
        selected={false}
        selectable={true}
        draggable={true}
        deletable={true}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={1}
        dragging={false}
      />
    )

    const nodeDiv = container.querySelector('div')
    expect(nodeDiv).not.toBeNull()
    fireEvent.doubleClick(nodeDiv!)

    expect(dispatched).toContain(5)
  })
})
