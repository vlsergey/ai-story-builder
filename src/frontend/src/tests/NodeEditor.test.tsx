import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import NodeEditor, { type NodeEditorAdapter } from '../components/NodeEditor'
import * as streamModule from '../lib/generate-node-stream'
import { PLAN_GRAPH_REFRESH_EVENT } from '../lib/plan-graph-events'
import * as planGraphEvents from '../lib/plan-graph-events'

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
vi.mock('../components/AiGenerationSettings', () => ({
  default: () => <div data-testid="ai-settings" />,
}))
vi.mock('../components/DiffViewAndAccept', () => ({
  default: () => <div data-testid="diff-view" />,
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAdapter(overrides: Partial<NodeEditorAdapter> = {}): NodeEditorAdapter {
  return {
    apiBase: '/api/lore',
    primaryField: 'name',
    i18nPrefix: 'lore',
    generateEndpoint: '/api/ai/generate-lore',
    onSaved: vi.fn(),
    ...overrides,
  }
}

/** Returns a fetch mock: first call is GET node, subsequent calls are PATCH responses. */
function makeFetchMock(nodeData: Record<string, unknown>, patchResponse = { ok: true, word_count: 3, char_count: 10, byte_count: 10 }) {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(nodeData) }) // GET /api/ai/config
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ current_engine: null }) }) // GET /api/ai/config
    .mockResolvedValue({ ok: true, json: () => Promise.resolve(patchResponse) }) // PATCH calls
}

const emptyNode = {
  name: 'Test Node',
  content: '',
  changes_status: null,
  review_base_content: null,
  last_improve_instruction: null,
  user_prompt: null,
  system_prompt: null,
}

const nodeWithContent = {
  name: 'Existing Node',
  content: 'existing content',
  changes_status: null,
  review_base_content: null,
  last_improve_instruction: null,
  user_prompt: 'old prompt',
  system_prompt: null,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NodeEditor — generate mode behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stays in generate mode after generation completes (does not switch to edit)', async () => {
    vi.stubGlobal('fetch', makeFetchMock(emptyNode))

    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation(async (_endpoint, options) => {
      options.onPartialJson?.({ name: 'Generated Name', content: 'Generated content' })
      options.onDone?.({})
    })

    render(<NodeEditor nodeId={1} adapter={makeAdapter()} />)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    const promptTextarea = screen.getByPlaceholderText('lore.userPrompt')
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
    vi.stubGlobal('fetch', makeFetchMock(nodeWithContent))

    let triggerPartial: (data: Record<string, unknown>) => void = () => {}
    let resolveStream: () => void = () => {}

    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation((_endpoint, options) => {
      triggerPartial = (data) => options.onPartialJson?.(data)
      return new Promise<void>(resolve => { resolveStream = resolve })
    })

    render(<NodeEditor nodeId={1} adapter={makeAdapter()} />)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    // Node has content; confirm dialog not needed — simulate already loaded with content
    // Since window.confirm would block, stub it to return true
    vi.stubGlobal('confirm', () => true)

    const promptTextarea = screen.getByPlaceholderText('lore.userPrompt')
    fireEvent.change(promptTextarea, { target: { value: 'regenerate this' } })

    // Start generation (don't await — stream is pending)
    fireEvent.click(screen.getByRole('button', { name: 'lore.regenerate' }))

    // BEFORE first token: existing content should still be visible
    await waitFor(() => {
      expect(screen.getByTestId('codemirror').getAttribute('value') ?? (screen.getByTestId('codemirror') as HTMLTextAreaElement).value)
        .toBe('existing content')
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

    vi.unstubAllGlobals()
  })

  it('replaces content progressively as tokens arrive (not appending)', async () => {
    vi.stubGlobal('fetch', makeFetchMock(emptyNode))

    const partialCalls: Array<(data: Record<string, unknown>) => void> = []
    let resolveStream: () => void = () => {}

    const generateNodeStream = vi.mocked(streamModule.generateNodeStream)
    generateNodeStream.mockImplementation((_endpoint, options) => {
      partialCalls.push((data) => options.onPartialJson?.(data))
      return new Promise<void>(resolve => { resolveStream = resolve })
    })

    render(<NodeEditor nodeId={1} adapter={makeAdapter()} />)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    const promptTextarea = screen.getByPlaceholderText('lore.userPrompt')
    fireEvent.change(promptTextarea, { target: { value: 'test prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'lore.generate' }))

    // Wait for the stream mock to be set up
    await waitFor(() => expect(partialCalls.length).toBe(1))
    const triggerPartial = partialCalls[0]

    // Send first partial (accumulated content "He")
    await act(async () => { triggerPartial({ content: 'He' }) })
    expect((screen.getByTestId('codemirror') as HTMLTextAreaElement).value).toBe('He')

    // Send second partial (accumulated content "Hello")
    await act(async () => { triggerPartial({ content: 'Hello' }) })
    expect((screen.getByTestId('codemirror') as HTMLTextAreaElement).value).toBe('Hello')
    // Must be replacement, not append: "HeHello" would be wrong
    expect((screen.getByTestId('codemirror') as HTMLTextAreaElement).value).not.toBe('HeHello')

    await act(async () => { resolveStream() })
  })
})

describe('NodeEditor — auto‑summary generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('triggers summary generation when plan node content changes and editor closes', async () => {
    // Mock fetch to return node data, AI config, and settings
    const fetchMock = vi.fn()
      // GET node
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        name: 'Plan Node',
        content: 'initial content',
        changes_status: null,
        review_base_content: null,
        last_improve_instruction: null,
        user_prompt: null,
        system_prompt: null,
      })})
      // GET /api/ai/config
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ current_engine: null })})
      // GET /api/settings/auto_generate_summary
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ value: 'true' })})
      // PATCH content (autosave) – we'll simulate a change
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ word_count: 5, char_count: 20, byte_count: 20 })})
    vi.stubGlobal('fetch', fetchMock)

    const planAdapter = makeAdapter({
      i18nPrefix: 'plan',
      apiBase: '/api/plan/nodes',
      generateEndpoint: '/api/ai/generate-plan',
      supportsAutoSummary: true,
    })

    const { unmount } = render(<NodeEditor nodeId={42} adapter={planAdapter} />)
    await screen.findByTestId('codemirror', {}, { timeout: 5000 })

    // Change content (simulate typing)
    const codemirror = screen.getByTestId('codemirror')
    fireEvent.change(codemirror, { target: { value: 'updated content' } })

    // Unmount component (simulate editor close) – this should trigger the cleanup effect
    unmount()

    // Expect a POST to /api/ai/generate-summary
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/generate-summary',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: 42, content: 'updated content' }),
      })
    )

    // Expect dispatchPlanGraphRefresh to have been called (after a setTimeout of 2000 ms)
    await waitFor(() => expect(vi.mocked(planGraphEvents.dispatchPlanGraphRefresh)).toHaveBeenCalled(), { timeout: 3000 })
  })

  it('does NOT trigger summary generation when setting is disabled', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        name: 'Plan Node',
        content: 'initial',
        changes_status: null,
        review_base_content: null,
        last_improve_instruction: null,
        user_prompt: null,
        system_prompt: null,
      })})
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ current_engine: null })})
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ value: 'false' })})
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ word_count: 1, char_count: 10, byte_count: 10 })})
    vi.stubGlobal('fetch', fetchMock)

    const planAdapter = makeAdapter({ i18nPrefix: 'plan', apiBase: '/api/plan/nodes', supportsAutoSummary: true })
    const { unmount } = render(<NodeEditor nodeId={42} adapter={planAdapter} />)
    await screen.findByTestId('codemirror', {}, { timeout: 5000 })

    const codemirror = screen.getByTestId('codemirror')
    fireEvent.change(codemirror, { target: { value: 'changed' } })

    unmount()

    // No call to /api/ai/generate-summary
    const generateSummaryCalls = fetchMock.mock.calls.filter(call => call[0] === '/api/ai/generate-summary')
    expect(generateSummaryCalls).toHaveLength(0)
    // dispatchPlanGraphRefresh should not be called either
    expect(vi.mocked(planGraphEvents.dispatchPlanGraphRefresh)).not.toHaveBeenCalled()
  })
})
