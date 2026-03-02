import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AppMenu from '../components/AppMenu'

// mock theme hook
vi.mock('../../src/lib/theme/theme-provider', () => ({
  useTheme: vi.fn()
}))
import { useTheme } from '../../src/lib/theme/theme-provider'

describe('AppMenu', () => {
  const themes = ['zinc', 'slate', 'neutral', 'obsidian', 'carbon']

  it('renders view menu and calls handlers', async () => {
    const setTheme = vi.fn()
    useTheme.mockReturnValue({ theme: 'zinc', setTheme })
    const onReset = vi.fn()

    render(<AppMenu onResetLayouts={onReset} />)

    // the trigger should exist
    const viewTrigger = screen.getByText('View')
    expect(viewTrigger).toBeInTheDocument()

    // open menu - Radix uses portal/animations so use pointerDown then click
    fireEvent.pointerDown(viewTrigger)
    fireEvent.click(viewTrigger)

    // options should now be visible (use findBy to wait)
    const resetItem = await screen.findByText('Reset layouts')
    expect(resetItem).toBeInTheDocument()
    themes.forEach(t => {
      const label = t[0].toUpperCase() + t.slice(1)
      expect(screen.getByText(label)).toBeInTheDocument()
    })

    // click reset item
    fireEvent.click(resetItem)
    expect(onReset).toHaveBeenCalled()

    // reopen menu to change theme
    fireEvent.pointerDown(viewTrigger)
    fireEvent.click(viewTrigger)
    const slateOption = await screen.findByText('Slate')
    fireEvent.click(slateOption)
    expect(setTheme).toHaveBeenCalledWith('slate')
  })
})