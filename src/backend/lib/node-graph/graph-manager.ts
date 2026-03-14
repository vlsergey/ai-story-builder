import type { Database } from 'better-sqlite3'
import type { NodeData, NodeContext } from './node-interfaces.js'
import type { PlanNodeRow, PlanEdgeRow } from '../../../shared/plan-graph.js'

/**
 * Graph manager that provides database access and implements NodeContext.
 */
export class GraphManager implements NodeContext {
  constructor(private db: Database) {}

  getNode(id: number): NodeData | undefined {
    const row = this.db.prepare('SELECT * FROM plan_nodes WHERE id = ?').get(id) as PlanNodeRow | undefined
    if (!row) {
      return undefined
    }
    return this.mapNodeRowToNodeData(row)
  }

  getIncomingEdges(nodeId: number): Array<{ from_node_id: number; type: string }> {
    const rows = this.db.prepare(
      'SELECT from_node_id, type FROM plan_edges WHERE to_node_id = ?'
    ).all(nodeId) as Array<{ from_node_id: number; type: string }>
    return rows
  }

  getOutgoingEdges(nodeId: number): Array<{ to_node_id: number; type: string }> {
    const rows = this.db.prepare(
      'SELECT to_node_id, type FROM plan_edges WHERE from_node_id = ?'
    ).all(nodeId) as Array<{ to_node_id: number; type: string }>
    return rows
  }

  /**
   * Get all inputs for a node (including expanded textArray edges).
   * Returns an array of NodeData for each input, with virtual titles for split parts.
   */
  getNodeInputs(nodeId: number): NodeData[] {
    const edges = this.getIncomingEdges(nodeId)
    const inputs: NodeData[] = []
    for (const edge of edges) {
      if (edge.type === 'text') {
        const source = this.getNode(edge.from_node_id)
        if (source) {
          inputs.push(source)
        }
      } else if (edge.type === 'textArray') {
        const expanded = this.expandTextArrayEdge(edge.from_node_id)
        inputs.push(...expanded)
      }
    }
    // Sort by edge position? We'll need edge position from the edges table.
    // For simplicity, keep as is.
    return inputs
  }

  /**
   * Expand a textArray edge into multiple virtual nodes.
   */
  private expandTextArrayEdge(sourceNodeId: number): NodeData[] {
    const source = this.getNode(sourceNodeId)
    if (!source || source.type !== 'splitter') {
      return []
    }
    // For now, we'll delegate to SplitterNode logic.
    // We'll need to create a SplitterNode instance.
    // This is a bit circular; we'll implement later.
    return []
  }

  private mapNodeRowToNodeData(row: PlanNodeRow): NodeData {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      user_prompt: row.user_prompt,
      system_prompt: row.system_prompt,
    }
  }
}