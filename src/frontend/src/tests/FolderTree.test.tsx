import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FolderTree from '../components/FolderTree';

// Mock the fetch API
global.fetch = vi.fn() as unknown as typeof fetch;

describe('FolderTree', () => {
  const mockProps = {
    onSelectLoreItem: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when tree data is an array', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve([{ id: 1, name: 'Folder 1', children: [] }])
    });

    expect(() => {
      render(<FolderTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles non-array tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ error: 'Invalid response' })
    });

    expect(() => {
      render(<FolderTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles null tree data gracefully', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve(null)
    });

    expect(() => {
      render(<FolderTree {...mockProps} />);
    }).not.toThrow();
  });
});
