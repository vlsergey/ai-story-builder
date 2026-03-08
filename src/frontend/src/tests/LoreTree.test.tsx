import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    mockFetchTree([{ id: 1, name: 'Story Lore', parent_id: null, status: 'ACTIVE', children: [] }]);
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
      position: 0,
      content: null,
      word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0,
      ai_sync_info: null,
      created_at: '2025-01-01T00:00:00Z',
      children: [
        { id: 2, parent_id: 1, name: 'Abilities', status: 'ACTIVE', position: 0, content: null, word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, ai_sync_info: null, created_at: '2025-01-01T00:00:00Z', children: [] },
        { id: 3, parent_id: 1, name: 'Spells',    status: 'ACTIVE', position: 1, content: null, word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, ai_sync_info: null, created_at: '2025-01-01T00:00:00Z', children: [] },
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
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', content: null,
         word_count: 42, char_count: 200, byte_count: 200,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.getByText('42w')).toBeTruthy();
  });

  it('shows char count badge when statMode is chars', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', content: null,
         word_count: 42, char_count: 200, byte_count: 200,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { statMode: 'chars' }
    );
    await screen.findByText('Chapter');
    expect(screen.getByText('200c')).toBeTruthy();
  });

  it('shows no stat badge when statMode is none', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', content: null,
         word_count: 42, char_count: 200, byte_count: 200,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { statMode: 'none' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText('42w')).toBeNull();
  });

  it('shows no stat badge when word_count is 0', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', content: null,
         word_count: 0, char_count: 0, byte_count: 0,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText(/\d+w/)).toBeNull();
  });

  it('does not show NaN in stat badge when word_count field is absent', async () => {
    // Simulates API returning nodes without the new stat columns (e.g. before migration)
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', content: null,
         to_be_deleted: 0, ai_sync_info: null, children: [] } as Partial<LoreNode>],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText(/NaN/i)).toBeNull();
  });

  it('aggregates subtree word count from children', async () => {
    renderWithSettings(
      [{
        id: 1, parent_id: null, name: 'Root', status: 'ACTIVE', content: null,
        position: 0,
        word_count: 10, char_count: 50, byte_count: 50,
        to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [
          { id: 2, parent_id: 1, name: 'Child', status: 'ACTIVE', content: null,
            position: 0,
            word_count: 32, char_count: 150, byte_count: 150,
            to_be_deleted: 0, ai_sync_info: null, children: [],
            created_at: '2025-01-01T00:00:00Z' },
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
         content: 'text',
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { currentAiEngine: null }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('.text-green-500')).toBeNull();
  });

  it('shows not-synced icon when engine is set and node has content via word_count', async () => {
    // A node with word_count > 0 has direct content — should show sync icon.
    const { container } = renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE',
         content: null,
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
         content: 'text',
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0,
         ai_sync_info: { grok: { last_synced_at: '2025-01-01T00:00:00Z' } },
         children: [] }],
      { currentAiEngine: 'grok' }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('[aria-label="synced"]')).not.toBeNull();
  });

  it('shows not-synced icon when node has content but not synced to current engine', async () => {
    const { container } = renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE',
         content: null,
         word_count: 5, char_count: 20, byte_count: 20,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { currentAiEngine: 'grok' }
    );
    await screen.findByText('Chapter');
    expect(container.querySelector('[aria-label="not synced"]')).not.toBeNull();
  });

  // ── Stat update on save ────────────────────────────────────────────────────

  it('updates node stats when lore-node-saved event fires', async () => {
    renderWithSettings(
      [{ id: 1, parent_id: null, name: 'Chapter', status: 'ACTIVE', content: null,
         word_count: 0, char_count: 0, byte_count: 0,
         to_be_deleted: 0, ai_sync_info: null, children: [] }],
      { statMode: 'words' }
    );
    await screen.findByText('Chapter');
    expect(screen.queryByText(/\d+w/)).toBeNull();

    window.dispatchEvent(new CustomEvent('lore-node-saved', {
      detail: { id: 1, wordCount: 7, charCount: 35, byteCount: 35 },
    }));

    await screen.findByText('7w');
  });

  it('updates aggregate parent stats when lore-node-saved fires for a child', async () => {
    renderWithSettings(
      [{
        id: 1, parent_id: null, name: 'Root', status: 'ACTIVE', content: null,
        position: 0,
        word_count: 0, char_count: 0, byte_count: 0,
        to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [{
          id: 2, parent_id: 1, name: 'Child', status: 'ACTIVE', content: null,
          position: 0,
          word_count: 0, char_count: 0, byte_count: 0,
          to_be_deleted: 0, ai_sync_info: null, children: [],
          created_at: '2025-01-01T00:00:00Z',
        }],
      }],
      { statMode: 'words' }
    );
    await screen.findByText('Child');
    expect(screen.queryByText(/\d+w/)).toBeNull();

    window.dispatchEvent(new CustomEvent('lore-node-saved', {
      detail: { id: 2, wordCount: 10, charCount: 50, byteCount: 50 },
    }));

    // Both child and root (aggregate) show '10w'
    const badges = await screen.findAllByText('10w');
    expect(badges).toHaveLength(2);
  });

  it('updates node name in tree when lore-node-saved event fires with name', async () => {
    mockFetchTree([{
      id: 1, parent_id: null, name: 'Old Name', status: 'ACTIVE', content: null,
      position: 0,
      word_count: 0, char_count: 0, byte_count: 0,
      to_be_deleted: 0, ai_sync_info: null,
      created_at: '2025-01-01T00:00:00Z',
      children: [],
    }]);

    render(
      <LoreSettingsContext.Provider value={{ statMode: 'words', currentAiEngine: null }}>
        <LoreTree onSelectLoreNode={vi.fn()} />
      </LoreSettingsContext.Provider>
    );

    await screen.findByText('Old Name');

    window.dispatchEvent(new CustomEvent('lore-node-saved', {
      detail: { id: 1, name: 'New Name' },
    }));

    await screen.findByText('New Name');
    expect(screen.queryByText('Old Name')).toBeNull();
  });

  // ── Grok collapsed-tree sync icons ────────────────────────────────────────

  it('shows synced icon on Grok group-leader node with word_count=0 after collapsed sync', async () => {
    // After a Grok sync, a level-2 category node can have word_count=0 (no own text)
    // but still carry a file_id because its subtree was collapsed into that file.
    // It should show "synced", not "not synced" or nothing.
    const syncedAt = '2025-01-01T12:00:00.000Z'
    const { container } = renderWithSettings(
      [{
        id: 1, parent_id: null, name: 'Root', status: 'ACTIVE',
        content: null,
        position: 0,
        word_count: 0, char_count: 0, byte_count: 0,
        to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [{
          id: 2, parent_id: 1, name: 'Characters', status: 'ACTIVE',
          content: null,
          position: 0,
          // Group leader: no own text but file uploaded for the whole subtree
          word_count: 0, char_count: 0, byte_count: 0,
          to_be_deleted: 0,
          ai_sync_info: { grok: { file_id: 'grok-f1', last_synced_at: syncedAt, content_updated_at: syncedAt } },
          created_at: '2025-01-01T00:00:00Z',
          children: [{
            id: 3, parent_id: 2, name: 'Hero', status: 'ACTIVE',
            content: null,
            position: 0,
            word_count: 5, char_count: 20, byte_count: 20,
            to_be_deleted: 0,
            ai_sync_info: { grok: { uploaded_as_parent: true, last_synced_at: syncedAt, content_updated_at: syncedAt } },
            created_at: '2025-01-01T00:00:00Z',
            children: [],
          }],
        }],
      }],
      { currentAiEngine: 'grok' }
    )
    await screen.findByText('Characters')
    // All items in the tree should show "synced" (green checkmark), none should show "not synced"
    expect(container.querySelector('[aria-label="not synced"]')).toBeNull()
    const synced = container.querySelectorAll('[aria-label="synced"]')
    expect(synced.length).toBeGreaterThan(0)
  })

  it('shows needs-sync on group-leader node when content updated after last sync', async () => {
    const { container } = renderWithSettings(
      [{
        id: 1, parent_id: null, name: 'Root', status: 'ACTIVE',
        content: null,
        position: 0,
        word_count: 0, char_count: 0, byte_count: 0,
        to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [{
          id: 2, parent_id: 1, name: 'Characters', status: 'ACTIVE',
          content: null,
          position: 0,
          word_count: 0, char_count: 0, byte_count: 0,
          to_be_deleted: 0,
          ai_sync_info: {
            grok: {
              file_id: 'grok-f1',
              last_synced_at: '2025-01-01T00:00:00Z',
              content_updated_at: '2025-06-01T00:00:00Z', // updated after sync
            },
          },
          created_at: '2025-01-01T00:00:00Z',
          children: [],
        }],
      }],
      { currentAiEngine: 'grok' }
    )
    await screen.findByText('Characters')
    expect(container.querySelector('[aria-label="not synced"]')).not.toBeNull()
  })

  it('shows no sync icon on root when all children are synced via Grok', async () => {
    // Root has word_count=0 and no ai_sync_info.
    // subtreeSyncState should aggregate children → synced → green on root too.
    const syncedAt = '2025-01-01T12:00:00.000Z'
    const { container } = renderWithSettings(
      [{
        id: 1, parent_id: null, name: 'Root', status: 'ACTIVE',
        content: null,
        position: 0,
        word_count: 0, char_count: 0, byte_count: 0,
        to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [{
          id: 2, parent_id: 1, name: 'World', status: 'ACTIVE',
          content: null,
          position: 0,
          word_count: 5, char_count: 20, byte_count: 20,
          to_be_deleted: 0,
          ai_sync_info: { grok: { file_id: 'grok-f1', last_synced_at: syncedAt, content_updated_at: syncedAt } },
          created_at: '2025-01-01T00:00:00Z',
          children: [],
        }],
      }],
      { currentAiEngine: 'grok' }
    )
    await screen.findByText('Root')
    // Root has no sync icon (syncState='none' for own node), but its subtree is synced
    // → subtreeSyncState returns 'synced' → root shows the green checkmark
    expect(container.querySelector('[aria-label="not synced"]')).toBeNull()
    // There should be synced icons (for Root via subtree and for World directly)
    const synced = container.querySelectorAll('[aria-label="synced"]')
    expect(synced.length).toBeGreaterThanOrEqual(1)
  })

  // ── Expand/collapse state ──────────────────────────────────────────────────

  it('does not re-expand collapsed nodes when tree is refreshed', async () => {
    const treeData: Partial<LoreNode>[] = [{
      id: 1, parent_id: null, name: 'Root', status: 'ACTIVE',
      content: null,
      position: 0,
      word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, ai_sync_info: null,
      created_at: '2025-01-01T00:00:00Z',
      children: [{
        id: 2, parent_id: 1, name: 'Category', status: 'ACTIVE',
        content: null,
        position: 0,
        word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [{
          id: 3, parent_id: 2, name: 'Item', status: 'ACTIVE',
          content: null,
          position: 0,
          word_count: 0, char_count: 0, byte_count: 0, to_be_deleted: 0, ai_sync_info: null,
          created_at: '2025-01-01T00:00:00Z',
          children: [],
        }],
      }],
    }]

    // First fetch: initial load
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ json: () => Promise.resolve(treeData) })
    render(
      <LoreSettingsContext.Provider value={{ statMode: 'none', currentAiEngine: null }}>
        <LoreTree onSelectLoreNode={vi.fn()} />
      </LoreSettingsContext.Provider>
    )

    // Initial load — all expanded, 'Item' is visible
    await screen.findByText('Item')

    // Collapse 'Category' by clicking its arrow button
    const arrowBtn = screen.getByText('Category').closest('div')?.querySelector('button')
    expect(arrowBtn).not.toBeNull()
    fireEvent.click(arrowBtn!)

    // 'Item' must disappear from DOM after collapse
    await waitFor(() => expect(screen.queryByText('Item')).toBeNull())

    // Simulate a tree refresh (e.g. after creating a child node)
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ json: () => Promise.resolve(treeData) })
    window.dispatchEvent(new Event('lore-tree-refresh'))

    // Wait for the second fetch to complete
    await waitFor(() => expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2))

    // 'Item' must remain hidden — refresh must NOT re-expand collapsed nodes
    expect(screen.queryByText('Item')).toBeNull()
  })

  // ── Keyboard interception ──────────────────────────────────────────────────

  it('does not intercept Enter key when focus is outside the lore tree', async () => {
    const onOpenLoreNode = vi.fn();
    mockFetchTree([{
      id: 1, parent_id: null, name: 'Root', status: 'ACTIVE',
      content: null,
      position: 0,
      word_count: 0, char_count: 0, byte_count: 0,
      to_be_deleted: 0, ai_sync_info: null,
      created_at: '2025-01-01T00:00:00Z',
      children: [{
        id: 2, parent_id: 1, name: 'Chapter', status: 'ACTIVE',
        content: null,
        position: 0,
        word_count: 0, char_count: 0, byte_count: 0,
        to_be_deleted: 0, ai_sync_info: null,
        created_at: '2025-01-01T00:00:00Z',
        children: [],
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
