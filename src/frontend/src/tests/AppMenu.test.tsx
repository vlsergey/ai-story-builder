import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AppMenu from '../components/AppMenu'

// mock theme hook
vi.mock('../lib/theme/theme-provider', () => ({
  useTheme: vi.fn()
}))
import { useTheme } from '../lib/theme/theme-provider'

describe('AppMenu', () => {
  it('renders view menu and calls handlers', async () => {
    const setPreference = vi.fn()
    vi.mocked(useTheme).mockReturnValue({ preference: 'auto', resolvedTheme: 'github', setPreference })
    const onReset = vi.fn()

    render(<AppMenu onResetLayouts={onReset} onClose={vi.fn()} />)

    // the trigger should exist
    const viewTrigger = screen.getByText('View')
    expect(viewTrigger).toBeInTheDocument()

    // open menu - Radix uses portal/animations so use pointerDown then click
    fireEvent.pointerDown(viewTrigger)
    fireEvent.click(viewTrigger)

    // options should now be visible (use findBy to wait)
    const resetItem = await screen.findByText('Reset layouts')
    expect(resetItem).toBeInTheDocument()
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(screen.getByText('Obsidian (dark)')).toBeInTheDocument()
    expect(screen.getByText('GitHub (light)')).toBeInTheDocument()

    // click reset item
    fireEvent.click(resetItem)
    expect(onReset).toHaveBeenCalled()

    // reopen menu to change theme
    fireEvent.pointerDown(viewTrigger)
    fireEvent.click(viewTrigger)
    const obsidianOption = await screen.findByText('Obsidian (dark)')
    fireEvent.click(obsidianOption)
    expect(setPreference).toHaveBeenCalledWith('obsidian')
  })
})
