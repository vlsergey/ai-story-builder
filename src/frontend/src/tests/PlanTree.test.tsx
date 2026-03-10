import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PlanTree from '../components/PlanTree';

// Mock the fetch API
global.fetch = vi.fn() as unknown as typeof fetch;

describe('PlanTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when tree data is an array', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve([{ id: 1, title: 'Node 1', children: [] }])
    });

    await act(async () => {
      render(<PlanTree />);
    });
  });

  it('handles non-array tree data gracefully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ error: 'Invalid response' })
    });

    await act(async () => {
      render(<PlanTree />);
    });
  });

  it('handles null tree data gracefully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve(null)
    });

    await act(async () => {
      render(<PlanTree />);
    });
  });
});
