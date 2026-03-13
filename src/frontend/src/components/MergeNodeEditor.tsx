import React, { useState, useEffect } from 'react'
import { useLocale } from '../lib/locale'
import { ipcClient } from '../ipcClient'
import { useTheme } from '../lib/theme/theme-provider'
import type { PlanGraphNode } from '../types/models'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { GripVertical, SortAsc, SortDesc, RefreshCw } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'

interface MergeNodeSettingsProps {
  node: PlanGraphNode
  onUpdate: (content: string) => void
  panelApi?: { setTitle: (title: string) => void }
  onNodeUpdated?: (node: PlanGraphNode) => void
}

interface InputNode {
  id: number
  title: string
  content: string | null
  position: number
}

export default function MergeNodeEditor({ node, onUpdate, panelApi, onNodeUpdated }: MergeNodeSettingsProps) {
  const { t } = useLocale()
  const { resolvedTheme } = useTheme()
  const [inputs, setInputs] = useState<InputNode[]>([])
  const [settings, setSettings] = useState({
    includeNodeTitle: false,
    includeInputTitles: false,
    fixHeaders: false,
    autoUpdate: false
  })

  // Load inputs and settings
  useEffect(() => {
    loadInputs()
    loadSettings()
  }, [node.id])

  // Load input nodes connected with merge_into edges
  async function loadInputs() {
    try {
      const graphData = await ipcClient.graph.get()
      const inputEdges = graphData.edges.filter(edge => edge.to_node_id === node.id && edge.type === 'merge_into')
      const inputNodes = inputEdges.map(edge => {
        const fromNode = graphData.nodes.find(n => n.id === edge.from_node_id)
        return fromNode ? {
          id: fromNode.id,
          title: fromNode.title,
          content: fromNode.content,
          position: edge.position
        } : null
      }).filter((node): node is InputNode => node !== null)
      
      // Sort by position
      inputNodes.sort((a, b) => a.position - b.position)
      setInputs(inputNodes)
    } catch (error) {
      console.error('Failed to load inputs:', error)
    }
  }

  // Load saved settings
  async function loadSettings() {
    try {
      // Get the node data which now contains merge_settings
      const nodeData = await ipcClient.graph.getNode(node.id)
      if (nodeData.merge_settings) {
        const parsed = JSON.parse(nodeData.merge_settings)
        setSettings(prev => ({ ...prev, ...parsed }))
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  // Save settings and fetch updated node
  async function saveSettings(newSettings?: typeof settings): Promise<PlanGraphNode | null> {
    const settingsToSave = newSettings ?? settings;
    try {
      // Update the node with new merge_settings (triggers regeneration)
      await ipcClient.graph.patchNode(node.id, {
        merge_settings: JSON.stringify(settingsToSave)
      });
      // Fetch updated node
      const updatedNode = await ipcClient.graph.getNode(node.id);
      onNodeUpdated?.(updatedNode);
      return updatedNode;
    } catch (error) {
      console.error('Failed to save settings:', error);
      return null;
    }
  }

  // Regenerate content via backend
  async function regenerateContent() {
    try {
      // Send current settings to trigger regeneration
      await ipcClient.graph.patchNode(node.id, {
        merge_settings: JSON.stringify(settings)
      });
      // Fetch updated node
      const updatedNode = await ipcClient.graph.getNode(node.id);
      onNodeUpdated?.(updatedNode);
    } catch (error) {
      console.error('Failed to regenerate content:', error);
    }
  }

  // Handle drag end
  async function onDragEnd(result: DropResult) {
    if (!result.destination) return

    const items = Array.from(inputs)
    const [reorderedItem] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, reorderedItem)

    // Update positions
    const updatedItems = items.map((item, index) => ({
      ...item,
      position: index
    }))

    setInputs(updatedItems)
    
    // Update edge positions
    try {
      const graphData = await ipcClient.graph.get()
      const updatePromises = updatedItems.map(async (item, index) => {
        const edge = graphData.edges.find(e => e.from_node_id === item.id && e.to_node_id === node.id)
        if (edge) {
          await ipcClient.graph.patchEdge(edge.id, { position: index })
        }
      })
      await Promise.all(updatePromises)
    } catch (error) {
      console.error('Failed to update edge positions:', error)
    }

    if (settings.autoUpdate) {
      regenerateContent()
    }
  }

  // Sort inputs alphabetically
  async function sortAlphabetical(reverse = false) {
    const sorted = [...inputs].sort((a, b) => {
      const comparison = a.title.localeCompare(b.title)
      return reverse ? -comparison : comparison
    })
    
    const updated = sorted.map((item, index) => ({
      ...item,
      position: index
    }))
    
    setInputs(updated)
    
    // Update edge positions
    try {
      const graphData = await ipcClient.graph.get()
      const updatePromises = updated.map(async (item, index) => {
        const edge = graphData.edges.find(e => e.from_node_id === item.id && e.to_node_id === node.id)
        if (edge) {
          await ipcClient.graph.patchEdge(edge.id, { position: index })
        }
      })
      await Promise.all(updatePromises)
    } catch (error) {
      console.error('Failed to update edge positions:', error)
    }

    if (settings.autoUpdate) {
      regenerateContent()
    }
  }

  // Update setting
  function updateSetting(key: keyof typeof settings, value: boolean) {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      if (key !== 'autoUpdate' || value) {
        // Save new settings (triggers backend regeneration)
        saveSettings(newSettings);
      }
      return newSettings;
    });
  }


  // Handle auto-update - ensure content is regenerated when any dependency changes
  useEffect(() => {
    if (settings.autoUpdate) {
      regenerateContent()
    }
  }, [inputs, settings, node.title])

  // Manual update button
  function handleManualUpdate() {
    regenerateContent()
  }

  // Update the tab title to show the node title
  useEffect(() => {
    if (panelApi) {
      panelApi.setTitle(node.title)
    }
  }, [node.title, panelApi])


  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('mergeNode.inputs')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-3">
            <Button variant="outline" size="sm" onClick={() => sortAlphabetical(false)}>
              <SortAsc className="h-4 w-4 mr-2" />
              {t('mergeNode.sortAlphabetical')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => sortAlphabetical(true)}>
              <SortDesc className="h-4 w-4 mr-2" />
              {t('mergeNode.sortAlphabeticalReverse')}
            </Button>
            <Button variant="outline" size="sm" onClick={loadInputs}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
          
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="inputs">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2 min-h-[80px]"
                >
                  {inputs.map((input, index) => (
                    <Draggable key={input.id} draggableId={String(input.id)} index={index}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className="flex items-center gap-2 p-2 bg-muted rounded hover:bg-muted/70"
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{input.title}</span>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('mergeNode.options')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <Label htmlFor="includeNodeTitle" className="text-sm mr-2">
              {t('mergeNode.includeNodeTitle')}
            </Label>
            <Switch
              id="includeNodeTitle"
              checked={settings.includeNodeTitle}
              onCheckedChange={(checked: boolean) => updateSetting('includeNodeTitle', checked)}
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="includeInputTitles" className="text-sm mr-2">
              {t('mergeNode.includeInputTitles')}
            </Label>
            <Switch
              id="includeInputTitles"
              checked={settings.includeInputTitles}
              onCheckedChange={(checked: boolean) => updateSetting('includeInputTitles', checked)}
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="fixHeaders" className="text-sm mr-2">
              {t('mergeNode.fixHeaders')}
            </Label>
            <Switch
              id="fixHeaders"
              checked={settings.fixHeaders}
              onCheckedChange={(checked: boolean) => updateSetting('fixHeaders', checked)}
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="autoUpdate" className="text-sm mr-2">
              {t('mergeNode.autoUpdate')}
            </Label>
            <Switch
              id="autoUpdate"
              checked={settings.autoUpdate}
              onCheckedChange={(checked: boolean) => updateSetting('autoUpdate', checked)}
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          {!settings.autoUpdate && (
            <Button onClick={handleManualUpdate} className="w-full">
              {t('common.update')}
            </Button>
          )}
        </CardContent>
      </Card>

      <CodeMirror
        value={node.content || ''}
        height="80vh"
        extensions={[markdown()]}
        theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
        className="border rounded"
        onChange={(value) => {
          onUpdate(value)
          // Also update the node content via IPC
          ipcClient.graph.patchNode(node.id, { content: value })
        }}
      />
    </div>
  )
}