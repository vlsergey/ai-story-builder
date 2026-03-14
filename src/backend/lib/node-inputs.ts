import type { Database } from 'better-sqlite3'

export interface NodeInput {
  id: number
  title: string
  content: string | null
  position: number
  edgeType: string
  sourceNodeId: number
}

/**
 * Fetch all inputs for a given node, expanding textArray edges into multiple virtual inputs.
 */
export function getNodeInputs(db: Database, nodeId: number): NodeInput[] {
  const edges = db.prepare(`
    SELECT e.id as edgeId, e.from_node_id, e.type as edgeType, e.position,
           n.id as sourceId, n.title, n.content, n.type as sourceType
    FROM plan_edges e
    JOIN plan_nodes n ON e.from_node_id = n.id
    WHERE e.to_node_id = ?
    ORDER BY e.position
  `).all(nodeId) as Array<{
    edgeId: number
    from_node_id: number
    edgeType: string
    position: number
    sourceId: number
    title: string
    content: string | null
    sourceType: string
  }>

  const inputs: NodeInput[] = []

  for (const edge of edges) {
    if (edge.edgeType === 'text') {
      inputs.push({
        id: edge.sourceId,
        title: edge.title,
        content: edge.content,
        position: edge.position,
        edgeType: edge.edgeType,
        sourceNodeId: edge.from_node_id,
      })
    } else if (edge.edgeType === 'textArray') {
      // Expand splitter outputs
      const expanded = expandTextArrayEdge(db, edge.sourceId, edge.position)
      inputs.push(...expanded)
    }
  }

  // Sort by position (and secondary by index within expansion)
  inputs.sort((a, b) => a.position - b.position)
  return inputs
}

/**
 * Split text by regex pattern.
 * Returns array of non-empty parts.
 */
function splitTextByRegex(text: string, regexPattern: string): string[] {
  if (!regexPattern.trim()) {
    // If regex is empty, treat as no splitting (whole text as one part)
    return [text]
  }
  try {
    const regex = new RegExp(regexPattern, 'g')
    const parts = text.split(regex)
    // Filter out empty strings? Keep them as they represent empty splits.
    return parts
  } catch (error) {
    // If regex is invalid, treat as literal string split (escape special chars?)
    // Fallback: split by literal pattern
    return text.split(regexPattern)
  }
}

/**
 * Get the input text for a splitter node (from its incoming edge).
 * Returns null if no incoming edge or no content.
 */
function getSplitterInputText(db: Database, splitterNodeId: number): string | null {
  const edge = db.prepare(`
    SELECT e.from_node_id, n.content
    FROM plan_edges e
    JOIN plan_nodes n ON e.from_node_id = n.id
    WHERE e.to_node_id = ? AND e.type = 'text'
    LIMIT 1
  `).get(splitterNodeId) as { from_node_id: number; content: string | null } | undefined
  if (!edge) {
    return null
  }
  return edge.content
}

/**
 * Expand a textArray edge into multiple virtual inputs based on splitter logic.
 * Returns an array of inputs (each with its own content).
 */
export function expandTextArrayEdge(db: Database, sourceNodeId: number, edgePosition: number): NodeInput[] {
  // Fetch splitter node details
  const node = db.prepare('SELECT content, title FROM plan_nodes WHERE id = ?').get(sourceNodeId) as
    | { content: string | null; title: string }
    | undefined
  if (!node) {
    return []
  }
  const regexPattern = node.content || ''
  const inputText = getSplitterInputText(db, sourceNodeId)
  if (inputText === null) {
    return []
  }
  const parts = splitTextByRegex(inputText, regexPattern)
  return parts.map((part, index) => ({
    id: sourceNodeId,
    title: `${node.title} [${index + 1}]`,
    content: part,
    position: edgePosition + index * 0.001, // keep ordering within same edge
    edgeType: 'textArray',
    sourceNodeId,
  }))
}