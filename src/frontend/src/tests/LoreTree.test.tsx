import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoreTree from '../components/LoreTree';

// Mock the fetch API
global.fetch = vi.fn() as unknown as typeof fetch;

describe('LoreTree', () => {
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
      render(<LoreTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles non-array tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ error: 'Invalid response' })
    });

    expect(() => {
      render(<LoreTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles null tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve(null)
    });

    expect(() => {
      render(<LoreTree {...mockProps} />);
    }).not.toThrow();
  });

  it('renders tree nodes after fetch resolves', async () => {
    const tree = [{
      id: 1, parent_id: null, name: 'Story Lore', status: 'ACTIVE',
      latest_version_status: null, position: 0,
      children: [
        { id: 2, parent_id: 1, name: 'Abilities', status: 'ACTIVE', latest_version_status: null, position: 0, children: [] },
        { id: 3, parent_id: 1, name: 'Spells',    status: 'ACTIVE', latest_version_status: null, position: 1, children: [] },
      ],
    }];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve(tree)
    });

    render(<LoreTree {...mockProps} />);
    await screen.findByText('Story Lore');
    expect(screen.getByText('Abilities')).toBeTruthy();
    expect(screen.getByText('Spells')).toBeTruthy();
  });
});
