import React from 'react'
import * as Menubar from '@radix-ui/react-menubar'
import { useTheme } from '../lib/theme/theme-provider'

const THEME_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'obsidian', label: 'Obsidian (dark)' },
  { value: 'github', label: 'GitHub (light)' },
]

// NOTE: Radix menus require the user to click the trigger to open the content.
// We apply simple tailwind classes to keep styling in line with the rest of the application.
export default function AppMenu({ onResetLayouts, onClose }) {
  const { preference, setPreference } = useTheme()

  return (
    <Menubar.Root className="flex relative bg-background border-b border-border text-sm">
      <Menubar.Menu>
        <Menubar.Trigger className="px-3 py-2 hover:bg-secondary/20 cursor-default">
          File
        </Menubar.Trigger>
        <Menubar.Content className="absolute top-full left-0 z-50 bg-background border border-border rounded-md shadow-lg p-1 min-w-[160px]">
          <Menubar.Group className="py-1">
            <Menubar.Item
              className="px-2 py-1 rounded hover:bg-secondary/20 cursor-pointer"
              onSelect={onClose}
            >
              Close Project
            </Menubar.Item>
          </Menubar.Group>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className="px-3 py-2 hover:bg-secondary/20 cursor-default">
          View
        </Menubar.Trigger>
        <Menubar.Content className="absolute top-full left-0 z-50 bg-background border border-border rounded-md shadow-lg p-1 min-w-[160px]">
          <Menubar.Group className="py-1">
            <Menubar.Item
              className="px-2 py-1 rounded hover:bg-secondary/20 cursor-pointer"
              onSelect={onResetLayouts}
            >
              Reset layouts
            </Menubar.Item>
          </Menubar.Group>
          <Menubar.Separator className="h-px bg-border my-1" />
          <Menubar.Group className="py-1">
            <Menubar.RadioGroup value={preference} onValueChange={setPreference}>
              {THEME_OPTIONS.map(({ value, label }) => (
                <Menubar.RadioItem
                  key={value}
                  value={value}
                  className="px-2 py-1 rounded hover:bg-secondary/20 cursor-pointer"
                >
                  {label}
                </Menubar.RadioItem>
              ))}
            </Menubar.RadioGroup>
          </Menubar.Group>
        </Menubar.Content>
      </Menubar.Menu>
    </Menubar.Root>
  )
}
