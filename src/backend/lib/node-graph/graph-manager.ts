import type { Database } from 'better-sqlite3'
import type { NodeData, NodeContext } from './node-interfaces.js'
import type { PlanNodeRow, PlanEdgeRow, PlanEdgeType } from '../../../shared/plan-graph.js'

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

  getIncomingEdges(nodeId: number): Array<{ from_node_id: number; type: PlanEdgeType }> {
    const rows = this.db.prepare(
      'SELECT from_node_id, type FROM plan_edges WHERE to_node_id = ?'
    ).all(nodeId) as Array<{ from_node_id: number; type: string }>
    // Cast each type to PlanEdgeType (should be safe because DB enforces)
    return rows.map(row => ({ ...row, type: row.type as PlanEdgeType }))
  }

  getOutgoingEdges(nodeId: number): Array<{ to_node_id: number; type: PlanEdgeType }> {
    const rows = this.db.prepare(
      'SELECT to_node_id, type FROM plan_edges WHERE from_node_id = ?'
    ).all(nodeId) as Array<{ to_node_id: number; type: string }>
    return rows.map(row => ({ ...row, type: row.type as PlanEdgeType }))
  }

  private mapNodeRowToNodeData(row: PlanNodeRow): NodeData {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      user_prompt: row.user_prompt,
      system_prompt: row.system_prompt,
      node_type_settings: row.node_type_settings,
    }
  }
}