import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoreTree from '../components/LoreTree';
import { LoreSettingsContext } from '../lib/lore-settings';
import type { LoreNode } from '../types/models';

// Mock the fetch API
global.fetch = vi.fn() as unknown as typeof fetch;

const mockFetchTree = (nodes: Partial<LoreNode>[]) => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    json: () => Promise.resolve(nodes)
  });
};

const mockProps = { onSelectLoreNode: vi.fn() };

/** Render LoreTree with a custom LoreSettings context value. */
function renderWithSettings(
  nodes: Partial<LoreNode>[],
  settings: { statMode?: 'none' | 'words' | 'chars' | 'bytes'; currentAiEngine?: string | null }
) {
  mockFetchTree(nodes);
  const { statMode = 'words', currentAiEngine = null } = settings;
  return render(
    <LoreSettingsContext.Provider value={{ statMode, currentAiEngine }}>
      <LoreTree {...mockProps} />
    </LoreSettingsContext.Provider>
  );
}

describe('LoreTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when tree data is an array', () => {
    mockFetchTree([{ id: 1, name: 'Story Lore', parent_id: null, status: 'ACTIVE', latest_version_status: null, children: [] }]);
    expect(() => render(<LoreTree {...mockProps} />)).not.toThrow();
  });

  it('handles non-array tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ error: 'Invalid response' })
    });
    expect(() => render(<LoreTree {...mockProps} />)).not.toThrow();
  });

  it('handles null tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve(null)
    });
    expect(() => render(<LoreTree {...mockProps} />)).not.toThrow();
  });

  it('renders tree nodes after fetch resolves', async () => {
    mockFetchTree([{
      id: 1, parent_id: null, name: 'Story Lore', status: 'ACTIVE',
      latest_version_status: null, position: 0,
      word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0,
      children: [
        { id: 2, parent_id: 1, name: 'Abilities', status: 'ACTIVE', latest_version_status: null, position: 0, word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, children: [] },
        { id: 3, parent_id: 1, name: 'Spells',    status: 'ACTIVE', latest_version_status: null, position: 1, word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, children: [] },
      ],
    }]);

    render(<LoreTree {...mockProps} />);
    await screen.findByText('Story Lore');
    expect(screen.getByText('Abilities')).toBeTruthy();
    expect(screen.getByText('Spells')).toBeTruthy();
  });

  // ── Stat badge ─────────────────────────────────────────────────────────────

  it('shows word count badge when node has word_count > 0', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', latest_version_status: null,
         word_count: 42, char_count: 200, byte_count: 200,
         to_be_deleted: 0, content: null, ai_sync_info: null, children: [] }],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.getByText('42w')).toBeTruthy();
  });

  it('shows char count badge when statMode is chars', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', latest_version_status: null,
         word_count: 42, char_count: 200, byte_count: 200,
         to_be_deleted: 0, content: null, ai_sync_info: null, children: [] }],
      { statMode: 'chars' }
    );
    await screen.findByText('Chapter');
    expect(screen.getByText('200c')).toBeTruthy();
  });

  it('shows no stat badge when statMode is none', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', latest_version_status: null,
         word_count: 42, char_count: 200, byte_count: 200,
         to_be_deleted: 0, content: null, ai_sync_info: null, children: [] }],
      { statMode: 'none' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText('42w')).toBeNull();
  });

  it('shows no stat badge when word_count is 0', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', latest_version_status: null,
         word_count: 0, char_count: 0, byte_count: 0,
         to_be_deleted: 0, content: null, ai_sync_info: null, children: [] }],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText(/\d+w/)).toBeNull();
  });

  it('does not show NaN in stat badge when word_count field is absent', async () => {
    // Simulates API returning nodes without the new stat columns (e.g. before migration)
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', latest_version_status: null,
         to_be_deleted: 0, content: null, ai_sync_info: null, children: [] } as Partial<LoreNode>],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText(/NaN/i)).toBeNull();
  });

  it('aggregates subtree word count from children', async () => {
    renderWithSettings(
      [{
        id: 1, parent_id: null, name: 'Root', status: 'ACTIVE', latest_version_status: null,
        word_count: 10, char_count: 50, byte_count: 50,
        to_be_deleted: 0, content: null, ai_sync_info: null,
        children: [
          { id: 2, parent_id: 1, name: 'Child', status: 'ACTIVE', latest_version_status: null,
            word_count: 32, char_count: 150, byte_count: 150,
            to_be_deleted: 0, content: null, ai_sync_info: null, children: [] },
        ],
      }],
      { statMode: 'words' }
    );
    await screen.findByText('Root');
    // Root shows sum: 10 + 32 = 42
    expect(screen.getByText('42w')).toBeTruthy();
    // Child shows only its own count
    expect(screen.getByText('32w')).toBeTruthy();
  });

  // ── Sync icon ──────────────────────────────────────────────────────────────

  it('shows no sync icon when currentAiEngine is null', async () => {
    const { container } = renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE',
         latest_version_status: 'ACTIVE', content: 'text',
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { currentAiEngine: null }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('.text-green-500')).toBeNull();
  });

  it('shows not-synced icon when engine is set and node has content via word_count but no versions', async () => {
    // The lore tree query does NOT return the content field (too large).
    // A node with word_count > 0 has direct content — should still show sync icon.
    const { container } = renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE',
         latest_version_status: null,  // no lore_versions rows
         content: null,                // not returned by the tree query
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { currentAiEngine: 'grok' }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('[aria-label="not synced"]')).not.toBeNull();
  });

  it('shows synced icon when node is synced with current engine', async () => {
    const { container } = renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE',
         latest_version_status: 'ACTIVE', content: 'text',
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0,
         ai_sync_info: { grok: { last_synced_at: '2025-01-01T00:00:00Z' } },
         children: [] }],
      { currentAiEngine: 'grok' }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('[aria-label="synced"]')).not.toBeNull();
  });

  it('shows not-synced icon when node has versions but not synced to current engine', async () => {
    const { container } = renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE',
         latest_version_status: 'ACTIVE', content: null,
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { currentAiEngine: 'grok' }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('[aria-label="not synced"]')).not.toBeNull();
  });

  // ── Keyboard interception ──────────────────────────────────────────────────

  it('does not intercept Enter key when focus is outside the lore tree', async () => {
    const onOpenLoreNode = vi.fn();
    mockFetchTree([{
      id: 1, parent_id: null, name: 'Root', status: 'ACTIVE',
      latest_version_status: null, word_count: 0, char_count: 0, byte_count: 0,
      to_be_deleted: 0, content: null, ai_sync_info: null,
      children: [{
        id: 2, parent_id: 1, name: 'Chapter', status: 'ACTIVE',
        latest_version_status: null, word_count: 0, char_count: 0, byte_count: 0,
        to_be_deleted: 0, content: null, ai_sync_info: null, children: [],
      }],
    }]);

    render(
      <LoreSettingsContext.Provider value={{ statMode: 'words', currentAiEngine: null }}>
        <LoreTree onSelectLoreNode={vi.fn()} onOpenLoreNode={onOpenLoreNode} />
      </LoreSettingsContext.Provider>
    );

    // Click a tree node to select/focus it in the tree's viewState
    await screen.findByText('Chapter');
    fireEvent.click(screen.getByText('Chapter'));

    // Simulate focus moving to an external contenteditable element (e.g. CodeMirror editor)
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    editor.focus();

    // Press Enter while the external editor has focus — tree should ignore it
    fireEvent.keyDown(editor, { key: 'Enter', bubbles: true });

    expect(onOpenLoreNode).not.toHaveBeenCalled();

    document.body.removeChild(editor);
  });
});
