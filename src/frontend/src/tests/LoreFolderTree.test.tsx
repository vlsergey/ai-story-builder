import React from 'react';
import { render } from '@testing-library/react';
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
});
