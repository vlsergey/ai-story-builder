import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useLocale } from '../lib/locale'
import { ipcClient } from '../ipcClient'
import { useTheme } from '../lib/theme/theme-provider'
import type { PlanGraphNode } from '../types/models'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'

interface SplitNodeSettingsProps {
  node: PlanGraphNode
  onUpdate: (content: string) => void
  panelApi?: { setTitle: (title: string) => void }
  onNodeUpdated?: (node: PlanGraphNode) => void
}

interface SplitPart {
  title: string
  content: string
}

export default function SplitNodeEditor({ node, onUpdate, panelApi, onNodeUpdated }: SplitNodeSettingsProps) {
  const { t } = useLocale()
  const { resolvedTheme } = useTheme()
  const [settings, setSettings] = useState({
    strategy: 'separator' as 'separator' | 'regexp',
    separator: '',
    autoUpdate: false,
    dropFirst: 0,
    dropLast: 0
  })
  const [parts, setParts] = useState<SplitPart[]>([])
  const [inputText, setInputText] = useState<string | null>(null)

  // Load split settings from node_type_settings
  const loadSettings = useCallback(async () => {
    try {
      const nodeData = await ipcClient.planGraph.getNode(node.id)
      if (nodeData.node_type_settings) {
        const parsed = JSON.parse(nodeData.node_type_settings)
        setSettings(prev => ({ ...prev, ...parsed }))
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [node.id])

  // Load input text from incoming edge
  const loadInput = useCallback(async () => {
    try {
      const graphData = await ipcClient.planGraph.get()
      const inputEdge = graphData.edges.find(edge => edge.to_node_id === node.id && edge.type === 'text')
      if (!inputEdge) {
        setInputText(null)
        return
      }
      const fromNode = graphData.nodes.find(n => n.id === inputEdge.from_node_id)
      setInputText(fromNode?.content || null)
    } catch (error) {
      console.error('Failed to load input:', error)
    }
  }, [node.id])

  // Load settings and input
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings()
    loadInput()
  }, [node.id, loadSettings, loadInput])

  // Parse content as JSON array of parts
  useEffect(() => {
    if (node.content) {
      try {
        const parsed = JSON.parse(node.content)
        if (Array.isArray(parsed)) {
          setParts(parsed)
        } else {
          setParts([])
        }
      } catch {
        setParts([])
      }
    } else {
      setParts([])
    }
  }, [node.content])

  // Save settings
  const saveSettings = useCallback(async (newSettings: typeof settings): Promise<PlanGraphNode | null> => {
    try {
      await ipcClient.planGraph.patchNode(node.id, {
        node_type_settings: JSON.stringify(newSettings)
      })
      const updatedNode = await ipcClient.planGraph.getNode(node.id)
      onNodeUpdated?.(updatedNode)
      return updatedNode
    } catch (error) {
      console.error('Failed to save settings:', error)
      return null
    }
  }, [node.id, onNodeUpdated])

  // Regenerate split parts based on input text and settings
  const regenerateParts = useCallback(async () => {
    if (!inputText) return
    let splitParts: string[] = []
    if (settings.strategy === 'separator') {
      splitParts = inputText.split(settings.separator)
    } else {
      // regexp strategy
      try {
        const regex = new RegExp(settings.separator, 'g')
        splitParts = inputText.split(regex)
      } catch (_error) {
        // fallback to literal split
        splitParts = inputText.split(settings.separator)
      }
    }
    // Apply dropFirst and dropLast
    let filteredParts = splitParts
    if (settings.dropFirst > 0) {
      filteredParts = filteredParts.slice(settings.dropFirst)
    }
    if (settings.dropLast > 0) {
      filteredParts = filteredParts.slice(0, -settings.dropLast)
    }
    // Convert to SplitPart objects with default titles
    const newParts: SplitPart[] = filteredParts.map((content, index) => ({
      title: `Part ${index + 1}`,
      content: content.trim()
    }))
    setParts(newParts)
    // Update node content with JSON array
    const newContent = JSON.stringify(newParts, null, 2)
    await ipcClient.planGraph.patchNode(node.id, { content: newContent })
    onUpdate(newContent)
    // Fetch updated node
    const updatedNode = await ipcClient.planGraph.getNode(node.id)
    onNodeUpdated?.(updatedNode)
  }, [inputText, settings, node.id, onUpdate, onNodeUpdated])

  // Debounced save settings
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const debouncedSaveSettings = useCallback((newSettings: typeof settings) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveSettings(newSettings)
    }, 1000)
  }, [saveSettings])

  // Debounced regenerate parts
  const regenerateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const debouncedRegenerateParts = useCallback(() => {
    if (regenerateTimeoutRef.current) clearTimeout(regenerateTimeoutRef.current)
    regenerateTimeoutRef.current = setTimeout(() => {
      regenerateParts()
    }, 1000)
  }, [regenerateParts])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (regenerateTimeoutRef.current) clearTimeout(regenerateTimeoutRef.current)
    }
  }, [])

  // Update setting
  function updateSetting<K extends keyof typeof settings>(key: K, value: typeof settings[K]) {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value }
      if (key !== 'autoUpdate' || value) {
        debouncedSaveSettings(newSettings)
      }
      return newSettings
    })
  }

  // Handle auto-update when input changes
  useEffect(() => {
    if (settings.autoUpdate && inputText) {
      debouncedRegenerateParts()
    }
  }, [inputText, settings.separator, settings.strategy, settings.autoUpdate, settings.dropFirst, settings.dropLast, debouncedRegenerateParts])

  // Update panel title
  useEffect(() => {
    if (panelApi) {
      panelApi.setTitle(node.title)
    }
  }, [node.title, panelApi])

  // Manual update button
  function handleManualUpdate() {
    regenerateParts()
  }

  // Handle content change via JSON editor
  function handleContentChange(value: string) {
    onUpdate(value)
    ipcClient.planGraph.patchNode(node.id, { content: value })
  }

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('splitNode.input')}</CardTitle>
        </CardHeader>
        <CardContent>
          {inputText ? (
            <div className="text-sm p-2 bg-muted rounded">
              <div className="font-medium mb-1">Input text preview:</div>
              <div className="whitespace-pre-wrap max-h-40 overflow-y-auto">{inputText}</div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No input connected (requires a text edge).</div>
          )}
          <Button variant="outline" size="sm" onClick={loadInput} className="mt-2">
            {t('common.refresh')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('splitNode.settings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <Label htmlFor="strategy" className="text-sm mr-2">
              {t('splitNode.strategy')}
            </Label>
            <select
              id="strategy"
              value={settings.strategy}
              onChange={(e) => updateSetting('strategy', e.target.value as 'separator' | 'regexp')}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="separator">Separator</option>
              <option value="regexp">Regular expression</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="separator" className="text-sm">
              {settings.strategy === 'separator' ? t('splitNode.separator') : t('splitNode.regexp')}
            </Label>
            <input
              id="separator"
              value={settings.separator}
              onChange={(e) => updateSetting('separator', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder={settings.strategy === 'separator' ? 'e.g., "\\n\\n"' : 'e.g., "\\\\s*---\\\\s*"'}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="autoUpdate" className="text-sm mr-2">
              {t('splitNode.autoUpdate')}
            </Label>
            <Switch
              id="autoUpdate"
              checked={settings.autoUpdate}
              onCheckedChange={(checked: boolean) => updateSetting('autoUpdate', checked)}
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropFirst" className="text-sm">
              {t('splitNode.dropFirst')}
            </Label>
            <input
              id="dropFirst"
              type="number"
              min="0"
              value={settings.dropFirst}
              onChange={(e) => updateSetting('dropFirst', parseInt(e.target.value) || 0)}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropLast" className="text-sm">
              {t('splitNode.dropLast')}
            </Label>
            <input
              id="dropLast"
              type="number"
              min="0"
              value={settings.dropLast}
              onChange={(e) => updateSetting('dropLast', parseInt(e.target.value) || 0)}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
          {!settings.autoUpdate && (
            <Button onClick={handleManualUpdate} className="w-full">
              {t('common.update')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('splitNode.parts')} ({parts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {parts.map((part, index) => (
              <div key={index} className="p-2 border rounded">
                <div className="font-medium text-sm">{part.title}</div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-20 overflow-y-auto">
                  {part.content}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <CodeMirror
        value={node.content || ''}
        height="80vh"
        extensions={[json()]}
        theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
        className="border rounded"
        onChange={handleContentChange}
      />
    </div>
  )
}