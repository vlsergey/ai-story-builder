import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import NodeEditor, { type NodeEditorAdapter } from './NodeEditor'
import * as streamModule from '../lib/generate-node-stream'
import * as planGraphEvents from '../lib/plan-graph-events'
import { ipcClient, trpc } from '../ipcClient'

// ── Dependency mocks ────────────────────────────────────────────────────────

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, readOnly }: { value: string; onChange?: (v: string) => void; readOnly?: boolean }) => (
    <textarea
      data-testid="codemirror"
      value={value}
      readOnly={readOnly ?? false}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}))

vi.mock('@codemirror/lang-markdown', () => ({ markdown: () => [] }))
vi.mock('@codemirror/view', () => ({ EditorView: { lineWrapping: [] } }))
vi.mock('lucide-react', () => ({
  Loader2: () => <span data-testid="loader" />,
  CheckCircle2: () => <span data-testid="check" />,
}))
vi.mock('../lib/theme/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'github' }) }))
vi.mock('../lib/editor-settings', () => ({ useEditorSettings: () => ({ wordWrap: false }) }))
vi.mock('../lib/locale', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('../lib/generate-node-stream')
vi.mock('../lib/codemirror-preserve-scroll', () => ({ preserveScrollOnExternalUpdate: [] }))
vi.mock('../lib/plan-graph-events', () => ({ dispatchPlanGraphRefresh: vi.fn() }))
vi.mock('../ai/AiGenerationSettingsForm', () => ({
  default: () => <div data-testid="ai-settings" />,
}))
vi.mock('../nodes/DiffViewAndAccept', () => ({
  default: () => <div data-testid="diff-view" />,
}))

// Mock ipcClient and trpc
vi.mock('../ipcClient', () => ({
  ipcClient: {
    ai: {
      generateSummary: {
        mutate: vi.fn().mockResolvedValue({}),
      },
    },
    plan: {
      nodes: {
        startReview: {
          mutate: vi.fn().mockResolvedValue({}),
        },
        acceptReview: {
          mutate: vi.fn().mockResolvedValue({}),
        },
      },
    },
  },
  trpc: {
    settings: {
      autoGenerateSummary: {
        get: {
          useQuery: vi.fn(() => ({ data: false })),
        },
      },
      allAiEnginesConfig: {
        currentEngine: {
          get: {
            useQuery: vi.fn(() => ({ data: 'grok' })),
          },
          defaultAiGenerationSettings: {
            get: {
              useQuery: vi.fn(() => ({ data: {} })),
            },
          },
        },
      },
    },
  },
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

const emptyNode = {
  name: 'Test Node',
  content: '',
  changes_status: null,
  review_base_content: null,
  last_improve_instruction: null,
  ai_instructions: null,
}

const nodeWithContent = {
  name: 'Existing Node',
  content: 'existing content',
  changes_status: null,
  review_base_content: null,
  last_improve_instruction: null,
  ai_instructions: 'old prompt',
}

function makeAdapter(nodeData: Record<string, unknown> = emptyNode, overrides: Partial<NodeEditorAdapter> = {}): NodeEditorAdapter {
  return {
    getNode: vi.fn().mockResolvedValue(nodeData),
    patchNode: vi.fn().mockResolvedValue({ ok: true, word_count: 3, char_count: 10, byte_count: 10 }),
    primaryField: 'name',
    i18nPrefix: 'lore',
    generateEndpoint: '/api/ai/generate-lore',
    ...overrides,
  }
}

function setupElectronAPI(invokeImpl?: (channel: string, ...args: unknown[]) => unknown) {
  window.electronAPI = {
    onMenuAction: vi.fn().mockReturnValue(vi.fn()),
    sendMenuState: vi.fn(),
    showErrorDialog: vi.fn(),
    alert: vi.fn(),
    confirm: vi.fn().mockReturnValue(true),
    invoke: vi.fn().mockImplementation(invokeImpl ?? ((channel: string) => {
      // These channels are no longer used by NodeEditor, but keep for compatibility
      if (channel === 'ai:config:get') return Promise.resolve({ current_engine: null })
      if (channel === 'settings:get') return Promise.resolve({ value: null })
      return Promise.resolve({})
    })),
    startStream: vi.fn().mockResolvedValue({ ok: true }),
    abortStream: vi.fn().mockResolvedValue({ ok: true }),
    onStreamEvent: vi.fn().mockReturnValue(vi.fn()),
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NodeEditor — generate mode behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupElectronAPI()
    // Reset trpc mocks
    vi.mocked(trpc.settings.autoGenerateSummary.get.useQuery).mockReturnValue({ data: false } as any)
    vi.mocked(trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery).mockReturnValue({ data: 'grok' } as any)
    vi.mocked(trpc.settings.allAiEnginesConfig.currentEngine.defaultAiGenerationSettings.get.useQuery).mockReturnValue({ data: {} } as any)
  })

  afterEach(() => {
    delete (window as any).electronAPI
  })

  it('stays in generate mode after generation completes (does not switch to edit)', async () => {
    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation(async (_endpoint, options) => {
      options.onPartialJson?.({ name: 'Generated Name', content: 'Generated content' })
      options.onDone?.({})
    })

    render(<NodeEditor nodeId={1} adapter={makeAdapter()} />)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    const promptTextarea = screen.getByPlaceholderText('lore.aiInstructions')
    fireEvent.change(promptTextarea, { target: { value: 'write something' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'lore.generate' }))
    })

    // The improve form (mode B) is always in the DOM but collapsed via maxHeight.
    // In generate mode its container must have maxHeight '0px' (not '50vh').
    const cancelBtn = screen.getByRole('button', { name: 'lore.cancel_improve' })
    const improveForm = cancelBtn.closest('div[style*="max-height"]') as HTMLElement
    expect(improveForm?.style.maxHeight).toBe('0px')
  })

  it('preserves existing content until first streaming token arrives', async () => {
    let triggerPartial: (data: Record<string, unknown>) => void = () => {}
    let resolveStream: () => void = () => {}

    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation((_endpoint, options) => {
      triggerPartial = (data) => options.onPartialJson?.(data)
      return new Promise<void>(resolve => { resolveStream = resolve })
    })

    render(<NodeEditor nodeId={1} adapter={makeAdapter(nodeWithContent)} />)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    // Node has content; confirm dialog not needed — simulate already loaded with content
    // window.electronAPI.confirm is already mocked to return true

    const promptTextarea = screen.getByPlaceholderText('lore.aiInstructions')
    fireEvent.change(promptTextarea, { target: { value: 'regenerate this' } })

    // Start generation (don't await — stream is pending)
    fireEvent.click(screen.getByRole('button', { name: 'lore.regenerate' }))

    // BEFORE first token: existing content should still be visible
    await waitFor(() => {
      const textarea = screen.getByTestId('codemirror') as HTMLTextAreaElement
      expect(textarea.value).toBe('existing content')
    })

    // Send first streaming token
    await act(async () => {
      triggerPartial({ name: 'New Name', content: 'new' })
    })

    // AFTER first token: content replaced (not appended)
    const codemirror = screen.getByTestId('codemirror') as HTMLTextAreaElement
    expect(codemirror.value).toBe('new')
    expect(codemirror.value).not.toContain('existing content')

    // Clean up: resolve the stream
    await act(async () => {
      resolveStream()
    })
  })

  it('replaces content progressively as tokens arrive (not appending)', async () => {
    const partialCalls: Array<(data: Record<string, unknown>) => void> = []
    let resolveStream: () => void = () => {}

    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation((_endpoint, options) => {
      partialCalls.push((data) => options.onPartialJson?.(data))
      return new Promise<void>(resolve => { resolveStream = resolve })
    })

    render(<NodeEditor nodeId={1} adapter={makeAdapter()} />)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    const promptTextarea = screen.getByPlaceholderText('lore.aiInstructions')
    fireEvent.change(promptTextarea, { target: { value: 'test prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'lore.generate' }))

    // Wait for the stream mock to be set up
    await waitFor(() => expect(partialCalls.length).toBe(1))
    const triggerPartial = partialCalls[0]

    // Send first partial (accumulated content "He")
    await act(async () => { triggerPartial({ content: 'He' }) })
    const textarea = screen.getByTestId('codemirror') as HTMLTextAreaElement
    expect(textarea.value).toBe('He')

    // Send second partial (accumulated content "Hello")
    await act(async () => { triggerPartial({ content: 'Hello' }) })
    expect(textarea.value).toBe('Hello')
    // Must be replacement, not append: "HeHello" would be wrong
    expect(textarea.value).not.toBe('HeHello')

    await act(async () => { resolveStream() })
  })
})

describe('NodeEditor — auto‑summary generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupElectronAPI()
    // Default mocks
    vi.mocked(trpc.settings.autoGenerateSummary.get.useQuery).mockReturnValue({ data: false } as any)
    vi.mocked(trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery).mockReturnValue({ data: 'grok' } as any)
    vi.mocked(trpc.settings.allAiEnginesConfig.currentEngine.defaultAiGenerationSettings.get.useQuery).mockReturnValue({ data: {} } as any)
    vi.mocked(ipcClient.ai.generateSummary.mutate).mockClear()
    vi.mocked(ipcClient.plan.nodes.startReview.mutate).mockClear()
    vi.mocked(ipcClient.plan.nodes.acceptReview.mutate).mockClear()
  })

  afterEach(() => {
    delete (window as any).electronAPI
  })

  it('triggers summary generation when plan node content changes and editor closes', async () => {
    // Enable auto‑summary
    vi.mocked(trpc.settings.autoGenerateSummary.get.useQuery).mockReturnValue({ data: true } as any)

    const planNodeData = {
      name: 'Plan Node',
      content: 'initial content',
      changes_status: null,
      review_base_content: null,
      last_improve_instruction: null,
      ai_instructions: null,
    }

    const planAdapter = makeAdapter(planNodeData, {
      i18nPrefix: 'plan',
      generateEndpoint: '/api/ai/generate-plan',
      supportsAutoSummary: true,
    })

    const { unmount } = render(<NodeEditor nodeId={42} adapter={planAdapter} />)
    await screen.findByTestId('codemirror', {}, { timeout: 5000 })

    // Change content (simulate typing)
    const codemirror = screen.getByTestId('codemirror') as HTMLTextAreaElement
    fireEvent.change(codemirror, { target: { value: 'updated content' } })

    // Unmount component (simulate editor close) – this should trigger the cleanup effect
    unmount()

    // Expect mutate to have been called with correct parameters
    expect(ipcClient.ai.generateSummary.mutate).toHaveBeenCalledWith(
      { node_id: 42, content: 'updated content' }
    )
  })

  it('does NOT trigger summary generation when setting is disabled', async () => {
    // auto‑summary disabled (default mock is false)
    const planNodeData = {
      name: 'Plan Node',
      content: 'initial',
      changes_status: null,
      review_base_content: null,
      last_improve_instruction: null,
      ai_instructions: null,
    }

    const planAdapter = makeAdapter(planNodeData, { i18nPrefix: 'plan', supportsAutoSummary: true })
    const { unmount } = render(<NodeEditor nodeId={42} adapter={planAdapter} />)
    await screen.findByTestId('codemirror', {}, { timeout: 5000 })

    const codemirror = screen.getByTestId('codemirror') as HTMLTextAreaElement
    fireEvent.change(codemirror, { target: { value: 'changed' } })

    unmount()

    // No call to generateSummary
    expect(ipcClient.ai.generateSummary.mutate).not.toHaveBeenCalled()
  })

  it('does NOT trigger summary generation during AI streaming (only on unmount)', async () => {
    // Enable auto‑summary
    vi.mocked(trpc.settings.autoGenerateSummary.get.useQuery).mockReturnValue({ data: true } as any)

    const planNodeData = {
      name: 'Plan Node',
      content: 'initial content',
      changes_status: null,
      review_base_content: null,
      last_improve_instruction: null,
      ai_instructions: null,
    }

    const planAdapter = makeAdapter(planNodeData, {
      i18nPrefix: 'plan',
      generateEndpoint: '/api/ai/generate-plan',
      supportsAutoSummary: true,
    })

    let triggerPartial: (data: Record<string, unknown>) => void = () => {}
    let resolveStream: () => void = () => {}

    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation((_endpoint, options) => {
      triggerPartial = (data) => options.onPartialJson?.(data)
      return new Promise<void>(resolve => { resolveStream = resolve })
    })

    const { unmount } = render(<NodeEditor nodeId={42} adapter={planAdapter} />)
    await screen.findByTestId('codemirror', {}, { timeout: 5000 })

    // Start AI generation (simulate user clicking generate)
    const promptTextarea = screen.getByPlaceholderText('plan.aiInstructions')
    fireEvent.change(promptTextarea, { target: { value: 'generate something' } })
    fireEvent.click(screen.getByRole('button', { name: 'plan.regenerate' }))

    // Wait for stream to be set up
    await waitFor(() => expect(generateNodeStream).toHaveBeenCalled())

    // Send a streaming token that changes content
    await act(async () => {
      triggerPartial({ content: 'partial content' })
    })

    // At this point, content has changed due to streaming.
    // With the bug, the summary generation would have been triggered.
    // With the fix, it should NOT be triggered.
    expect(ipcClient.ai.generateSummary.mutate).not.toHaveBeenCalled()

    // Send another token
    await act(async () => {
      triggerPartial({ content: 'more partial content' })
    })

    // Still no summary call
    expect(ipcClient.ai.generateSummary.mutate).not.toHaveBeenCalled()

    // Finish streaming
    await act(async () => {
      resolveStream()
    })

    // Unmount component (simulate editor close)
    unmount()

    // Now summary generation should be triggered because content changed (final content)
    expect(ipcClient.ai.generateSummary.mutate).toHaveBeenCalledWith(
      { node_id: 42, content: 'more partial content' }
    )
  })
})
