import type { PlanEdgeCreate, PlanEdgeUpdate, PlanEdgeRow } from '../../../shared/plan-graph.js'
import { withDbWrite, withDbRead } from '../../db/connection.js'

/**
 * Repository for plan_edges table operations.
 * Encapsulates all SQL queries related to plan edges.
 * Manages its own database connections.
 */
export class PlanEdgeRepository {
  // ─── Basic CRUD ──────────────────────────────────────────────────────────────

  /**
   * Get all edges (full rows) ordered by position, id.
   */
  findAll(): PlanEdgeRow[] {
    return withDbRead(db =>
      db.prepare('SELECT * FROM plan_edges ORDER BY position, id').all() as PlanEdgeRow[]
    )
  }

  /**
   * Get a single edge by ID, or undefined if not found.
   */
  getById(id: number): PlanEdgeRow | undefined {
    return withDbRead(db =>
      db.prepare('SELECT * FROM plan_edges WHERE id = ?').get(id) as PlanEdgeRow | undefined
    )
  }

  /**
   * Get edges where the given node is the source (from_node_id).
   */
  findByFromNodeId(fromNodeId: number): PlanEdgeRow[] {
    return withDbRead(db =>
      db
        .prepare('SELECT * FROM plan_edges WHERE from_node_id = ? ORDER BY position, id')
        .all(fromNodeId) as PlanEdgeRow[]
    )
  }

  /**
   * Get edges where the given node is the target (to_node_id).
   */
  findByToNodeId(toNodeId: number): PlanEdgeRow[] {
    return withDbRead(db =>
      db
        .prepare('SELECT * FROM plan_edges WHERE to_node_id = ? ORDER BY position, id')
        .all(toNodeId) as PlanEdgeRow[]
    )
  }

  /**
   * Get edges where the given node is the target and have a specific type.
   * Ordered by position, id.
   */
  getByToNodeIdAndType(toNodeId: number, type: string): PlanEdgeRow[] {
    return withDbRead(db =>
      db
        .prepare('SELECT * FROM plan_edges WHERE to_node_id = ? AND type = ? ORDER BY position, id')
        .all(toNodeId, type) as PlanEdgeRow[]
    )
  }

  /**
   * Get the first edge (by position) where the given node is the target and has a specific type.
   * Returns undefined if none found.
   */
  getFirstByToNodeIdAndType(toNodeId: number, type: string): PlanEdgeRow | undefined {
    return withDbRead(db =>
      db
        .prepare('SELECT * FROM plan_edges WHERE to_node_id = ? AND type = ? ORDER BY position, id LIMIT 1')
        .get(toNodeId, type) as PlanEdgeRow | undefined
    )
  }

  /**
   * Get edges where the given node is either source or target.
   */
  getByNodeId(nodeId: number): PlanEdgeRow[] {
    return withDbRead(db =>
      db
        .prepare('SELECT * FROM plan_edges WHERE from_node_id = ? OR to_node_id = ? ORDER BY position, id')
        .all(nodeId, nodeId) as PlanEdgeRow[]
    )
  }

  /**
   * Count total edges.
   */
  count(): number {
    return withDbRead(db => {
      const row = db.prepare('SELECT COUNT(*) AS c FROM plan_edges').get() as { c: number }
      return row.c
    })
  }

  // ─── Insert ──────────────────────────────────────────────────────────────────

  /**
   * Insert a new edge with the given fields.
   * Returns the inserted row's ID.
   */
  insert(data: PlanEdgeCreate): number {
    return withDbWrite(db => {
      const fromNodeId = data.from_node_id
      const toNodeId = data.to_node_id
      const type = data.type ?? 'text'
      const position = data.position ?? 0
      const label = data.label ?? null
      const template = data.template ?? null

      const stmt = db.prepare(`
        INSERT INTO plan_edges (from_node_id, to_node_id, type, position, label, template)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const info = stmt.run(fromNodeId, toNodeId, type, position, label, template)
      return Number(info.lastInsertRowid)
    })
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Update multiple fields of an edge.
   * The fields object can contain any column of plan_edges.
   * Returns the number of rows changed.
   */
  update(id: number, fields: PlanEdgeUpdate): number {
    return withDbWrite(db => {
      const keys = Object.keys(fields) as (keyof typeof fields)[]
      if (keys.length === 0) return 0
      const setClause = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => fields[k])
      const stmt = db.prepare(`UPDATE plan_edges SET ${setClause} WHERE id = ?`)
      const info = stmt.run(...values, id)
      return info.changes
    })
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  /**
   * Delete an edge by ID.
   */
  delete(id: number): void {
    return withDbWrite(db => {
      db.prepare('DELETE FROM plan_edges WHERE id = ?').run(id)
    })
  }

  /**
   * Delete all edges where the given node is either source or target.
   */
  deleteByNodeId(nodeId: number): void {
    return withDbWrite(db => {
      db.prepare('DELETE FROM plan_edges WHERE from_node_id = ? OR to_node_id = ?').run(nodeId, nodeId)
    })
  }
}