import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoreFolderTree from '../components/LoreFolderTree';

// Mock the fetch API
global.fetch = vi.fn() as unknown as typeof fetch;

describe('LoreFolderTree', () => {
  const mockProps = {
    onSelectLoreNode: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when tree data is an array', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve([{ id: 1, name: 'Story Lore', parent_id: null, status: 'ACTIVE', latest_version_status: null, children: [] }])
    });

    expect(() => {
      render(<LoreFolderTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles non-array tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ error: 'Invalid response' })
    });

    expect(() => {
      render(<LoreFolderTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles null tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve(null)
    });

    expect(() => {
      render(<LoreFolderTree {...mockProps} />);
    }).not.toThrow();
  });

  it('drag-and-drop: dropping a node calls /move exactly once (drop event must not bubble to ancestor nodes)', async () => {
    // Tree: root → [Abilities (id=2), Spells (id=3)]
    // Dropping Spells onto Abilities should call /move once with parent_id=2.
    // Without stopPropagation the drop also fires on root's <li>,
    // triggering a second /move call with parent_id=1 that reverts the move.
    const tree = [{
      id: 1, parent_id: null, name: 'root', status: 'ACTIVE',
      latest_version_status: null, position: 0,
      children: [
        { id: 2, parent_id: 1, name: 'Abilities', status: 'ACTIVE', latest_version_status: null, position: 0, children: [] },
        { id: 3, parent_id: 1, name: 'Spells',    status: 'ACTIVE', latest_version_status: null, position: 1, children: [] },
      ],
    }];

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    fetchMock.mockResolvedValueOnce({ json: () => Promise.resolve(tree) }); // initial /tree

    render(<LoreFolderTree {...mockProps} />);
    await screen.findByText('Abilities');

    const abilitiesLi = screen.getByText('Abilities').closest('li')!;
    const spellsLi   = screen.getByText('Spells').closest('li')!;

    // Simulate drag from Spells → drop onto Abilities
    const dt = {
      data: {} as Record<string, string>,
      setData(k: string, v: string) { this.data[k] = v; },
      getData(k: string) { return this.data[k] ?? ''; },
      effectAllowed: '', dropEffect: '',
    };
    fireEvent.dragStart(spellsLi, { dataTransfer: dt });
    fireEvent.drop(abilitiesLi, { dataTransfer: dt });

    await waitFor(() => {
      const moveCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === 'string' && (url as string).includes('/move')
      );
      // Must be called exactly once — bubbling would cause two calls
      expect(moveCalls).toHaveLength(1);
      expect(JSON.parse(moveCalls[0][1]?.body as string)).toEqual({ parent_id: 2 });
    });
  });
});
