import { GraphEngine } from '../lib/node-graph/engine/graph-engine.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// ── Merge content generation ──────────────────────────────────────────────────
// Generates merged content for a merge node by combining input nodes according to settings.
// Settings:
// - includeNodeTitle: adds node title as h1 before content
// - includeInputTitles: adds each input title as h2 before its content
// - fixHeaders: adjusts header levels:
//   * The top‑level header (h1) at the start of an input is removed entirely, and any following empty lines are trimmed.
//   * All remaining headers are shifted so that the highest level becomes h3.
// - autoUpdate: not used in backend generation; frontend may use it for live updates.
export function generateMergeContent(
  db: import('better-sqlite3').Database,
  nodeId: number,
  overrideSettings?: Record<string, any>,
  overrideTitle?: string
): string {
  // Fetch node if needed
  let nodeTitle: string
  let nodeMergeSettings: string | null = null
  if (overrideTitle === undefined || overrideSettings === undefined) {
    const node = db.prepare('SELECT title, node_type_settings FROM plan_nodes WHERE id = ? AND type = \'merge\'').get(nodeId) as { title: string, node_type_settings: string | null } | undefined
    if (!node) {
      throw makeError('Merge node not found', 404)
    }
    nodeTitle = node.title
    nodeMergeSettings = node.node_type_settings
  } else {
    nodeTitle = overrideTitle
  }

  // Parse settings
  const defaultSettings = {
    includeNodeTitle: false,
    includeInputTitles: false,
    fixHeaders: false,
    autoUpdate: false,
  }
  let settings = defaultSettings
  if (overrideSettings !== undefined) {
    settings = { ...defaultSettings, ...overrideSettings }
  } else if (nodeMergeSettings) {
    try {
      settings = { ...defaultSettings, ...JSON.parse(nodeMergeSettings) }
    } catch (_) {
      // If JSON invalid, keep defaults
    }
  }

  // Fetch input nodes ordered by edge position (including expanded textArray edges)
  const engine = new GraphEngine(db)
  const rawInputs = engine.getNodeInputsRaw(nodeId)
  const inputs: Array<{ title: string; content: string | null }> = []

  for (const raw of rawInputs) {
    if (raw.edgeType === 'text') {
      const sourceNode = engine.getNode(raw.sourceNodeId)
      if (!sourceNode) continue
      inputs.push({
        title: sourceNode.title,
        content: typeof raw.output === 'string' ? raw.output : null,
      })
    } else if (raw.edgeType === 'textArray') {
      const sourceNode = engine.getNode(raw.sourceNodeId)
      if (!sourceNode) continue
      const parts = Array.isArray(raw.output) ? raw.output : []
      parts.forEach((part, index) => {
        inputs.push({
          title: `${sourceNode.title} [${index + 1}]`,
          content: typeof part === 'string' ? part : String(part),
        })
      })
    }
  }

  // TODO: sort by edge position

  let content = ''

  // Add node title as h1 if enabled
  if (settings.includeNodeTitle) {
    content += `# ${nodeTitle}\n\n`
  }

  // Add each input
  for (const input of inputs) {
    if (input.content) {
      // Add input title as h2 if enabled
      if (settings.includeInputTitles) {
        content += `## ${input.title}\n\n`
      }

      let inputContent = input.content

      // Fix headers if enabled
      if (settings.fixHeaders) {
        // Split into lines
        const lines = inputContent.split('\n')
        // Detect headers and their levels
        const headerLines: { index: number; level: number; line: string }[] = []
        lines.forEach((line: string, idx: number) => {
          const match = line.match(/^(#{1,6})\s+(.*)/)
          if (match) {
            const level = match[1].length
            headerLines.push({ index: idx, level, line })
          }
        })

        if (headerLines.length > 0) {
          // Find minimum header level
          const minLevel = Math.min(...headerLines.map(h => h.level))
          // Count headers with minLevel
          const minLevelHeaders = headerLines.filter(h => h.level === minLevel)
          // Check if the first non-empty line is a header of minLevel
          const firstNonEmptyIdx = lines.findIndex((line: string) => line.trim() !== '')
          const isFirstLineHeader = firstNonEmptyIdx >= 0 && headerLines.some(h => h.index === firstNonEmptyIdx && h.level === minLevel)

          // If there is exactly one header of minLevel and it's the first non-empty line, remove the line entirely
          if (minLevelHeaders.length === 1 && isFirstLineHeader) {
            const target = minLevelHeaders[0]
            lines.splice(target.index, 1)
            // Remove any leading empty lines that may have been left after removal
            let removedCount = 1
            while (target.index < lines.length && lines[target.index].trim() === '') {
              lines.splice(target.index, 1)
              removedCount++
            }
            // Adjust indices of headers after the removed lines
            headerLines.forEach(h => {
              if (h.index > target.index) h.index -= removedCount
            })
            // Remove the target from headerLines
            headerLines.splice(headerLines.indexOf(target), 1)
          }

          // After possible removal, recompute minLevel among remaining headers
          const remainingMinLevel = headerLines.length > 0 ? Math.min(...headerLines.map(h => h.level)) : 6
          // Shift all headers so that the highest level becomes h3 (level 3)
          const shift = 3 - remainingMinLevel
          if (shift > 0) {
            headerLines.forEach(h => {
              const newLevel = Math.min(h.level + shift, 6)
              const newLine = '#'.repeat(newLevel) + h.line.substring(h.level)
              lines[h.index] = newLine
            })
          }
        }

        inputContent = lines.join('\n')
      }

      content += inputContent + '\n\n'
    }
  }

  // Remove trailing newlines
  content = content.trim()
  return content
}