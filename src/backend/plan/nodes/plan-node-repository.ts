import type { PlanNodeCreate, PlanNodeUpdate, PlanNodeRow } from '../../../shared/plan-graph.js'
import { withDbWrite, withDbRead } from '../../db/connection.js'

/**
 * Repository for plan_nodes table operations.
 * Encapsulates all SQL queries related to plan nodes.
 * Manages its own database connections.
 */
export class PlanNodeRepository {
  // ─── Basic CRUD ──────────────────────────────────────────────────────────────

  /**
   * Get all nodes (full rows) ordered by position, id.
   */
  getAll(): PlanNodeRow[] {
    return withDbRead(db =>
      db.prepare('SELECT * FROM plan_nodes ORDER BY position, id').all() as PlanNodeRow[]
    )
  }

  /**
   * Get a single node by ID, or undefined if not found.
   */
  getById(id: number): PlanNodeRow | undefined {
    return withDbRead(db =>
      db.prepare('SELECT * FROM plan_nodes WHERE id = ?').get(id) as PlanNodeRow | undefined
    )
  }

  /**
   * Get nodes by parent ID (for tree building).
   */
  getByParentId(parentId: number | null): PlanNodeRow[] {
    return withDbRead(db =>
      db
        .prepare('SELECT * FROM plan_nodes WHERE parent_id IS ? ORDER BY position, id')
        .all(parentId) as PlanNodeRow[]
    )
  }

  /**
   * Get the maximum position among children of a given parent.
   * Internal helper that expects a database connection.
   */
  private getMaxPosition(db: import('better-sqlite3').Database, parentId: number | null): number {
    const row = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM plan_nodes WHERE parent_id IS ?')
      .get(parentId) as { max: number } | undefined
    return row?.max ?? -1
  }

  /**
   * Count total nodes.
   */
  count(): number {
    return withDbRead(db => {
      const row = db.prepare('SELECT COUNT(*) AS c FROM plan_nodes').get() as { c: number }
      return row.c
    })
  }

  // ─── Insert ──────────────────────────────────────────────────────────────────

  /**
   * Insert a new node with the given fields.
   * Returns the inserted row's ID.
   */
  insert(data: PlanNodeCreate): number {
    return withDbWrite(db => {
      const parentId = data.parent_id ?? null
      const position = data.position ?? (this.getMaxPosition(db, parentId) + 1)
      const type = data.type ?? 'text'
      const x = data.x ?? 0
      const y = data.y ?? 0
      const content = data.content ?? null
      const aiUserPrompt = data.ai_user_prompt ?? null
      const aiSystemPrompt = data.ai_system_prompt ?? null
      const summary = data.summary ?? null
      const aiSyncInfo = data.ai_sync_info ?? null
      const nodeTypeSettings = data.node_type_settings ?? null
      const aiSettings = data.ai_settings ?? null
      const wordCount = data.word_count ?? 0
      const charCount = data.char_count ?? 0
      const byteCount = data.byte_count ?? 0
      const status = data.status ?? 'EMPTY'
      const inReview = data.in_review ?? 0
      const reviewBaseContent = data.review_base_content ?? null
      const aiImproveInstruction = data.ai_improve_instruction ?? null

      const stmt = db.prepare(`
        INSERT INTO plan_nodes (
          parent_id, title, position, content,
          type, x, y, ai_user_prompt, ai_system_prompt,
          summary, ai_sync_info, node_type_settings, ai_settings,
          word_count, char_count, byte_count, status,
          in_review, review_base_content, ai_improve_instruction
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      const info = stmt.run(
        parentId,
        data.title,
        position,
        content,
        type,
        x,
        y,
        aiUserPrompt,
        aiSystemPrompt,
        summary,
        aiSyncInfo,
        nodeTypeSettings,
        aiSettings,
        wordCount,
        charCount,
        byteCount,
        status,
        inReview,
        reviewBaseContent,
        aiImproveInstruction
      )
      return Number(info.lastInsertRowid)
    })
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Update multiple fields of a node.
   * The fields object can contain any column of plan_nodes.
   * Returns updated object.
   */
  patch(id: number, fields: PlanNodeUpdate): PlanNodeRow | undefined {
    return withDbWrite(db => {
      const keys = Object.keys(fields) as (keyof typeof fields)[]
      if (keys.length === 0) throw Error('Need at least one updated field')

      const setClause = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => fields[k])
      const stmt = db.prepare(`UPDATE plan_nodes SET ${setClause} WHERE id = ? RETURNING *`)
      return stmt.get(...values, id) as PlanNodeRow | undefined
    })
  }

  /**
   * Delete a node by ID (cascades to edges via foreign key, children via parent_id).
   */
  delete(id: number): void {
    return withDbWrite(db => {
      db.prepare('DELETE FROM plan_nodes WHERE id = ?').run(id)
    })
  }
}