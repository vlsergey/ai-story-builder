import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PlanTree from '../components/PlanTree';

// Mock the fetch API
global.fetch = vi.fn();

describe('PlanTree', () => {
  const mockProps = {
    dbPath: '/test/db/path',
    onSelect: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when tree data is an array', () => {
    global.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve([{ id: 1, title: 'Node 1', children: [] }])
    });

    expect(() => {
      render(<PlanTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles non-array tree data gracefully', () => {
    global.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: 'Invalid response' })
    });

    expect(() => {
      render(<PlanTree {...mockProps} />);
    }).not.toThrow();
  });

  it('handles null tree data gracefully', () => {
    global.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve(null)
    });

    expect(() => {
      render(<PlanTree {...mockProps} />);
    }).not.toThrow();
  });
});