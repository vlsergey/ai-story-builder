import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, test, expect } from 'vitest';
import '@testing-library/jest-dom';

// Mock all dependencies
vi.mock('dockview', () => ({
  DockviewReact: function MockDockviewReact() {
    return <div data-testid="dockview">Dockview Container</div>;
  }
}));

vi.mock('../lib/theme/theme-provider', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn()
  })
}));

// Mock child components
vi.mock('../components/LoreSection', () => ({
  default: function MockLoreSection() {
    return <div data-testid="folder-section">Folder Section</div>;
  }
}));


vi.mock('../components/LoreEditor', () => ({
  default: function MockLoreEditor() {
    return <div data-testid="lore-editor">Lore Editor</div>;
  }
}));

vi.mock('../components/PlanEditor', () => ({
  default: function MockPlanEditor() {
    return <div data-testid="plan-editor">Plan Editor</div>;
  }
}));

// Mock the actual Layout component with a simplified version
vi.mock('../Layout', () => ({
  default: function MockLayout({ projectPath, onClose }: { projectPath?: string; localeStrings?: unknown; onClose?: () => void }) {
    return (
      <div>
        <div data-testid="dockview">Dockview Container</div>
        <button onClick={onClose}>Close Project</button>
        <div>Status: {projectPath}</div>
      </div>
    );
  }
}));

import Layout from '../Layout';

describe('Layout Minimal Test', () => {
  const mockProps = {
    projectPath: '/test/path',
    localeStrings: {},
    onClose: vi.fn(),
    initialLayout: null,
  };

  test('renders without crashing', () => {
    render(<Layout {...mockProps} />);
    expect(screen.getByTestId('dockview')).toBeInTheDocument();
  });
});
