import type { PlanNodeCreate, PlanNodeUpdate, PlanNodeRow, PlanNodeStatus } from '../../../shared/plan-graph.js'
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
      const userPrompt = data.user_prompt ?? null
      const systemPrompt = data.system_prompt ?? null
      const summary = data.summary ?? null
      const autoSummary = data.auto_summary ?? 0
      const aiSyncInfo = data.ai_sync_info ?? null
      const nodeTypeSettings = data.node_type_settings ?? null
      const aiSettings = data.ai_settings ?? null
      const wordCount = data.word_count ?? 0
      const charCount = data.char_count ?? 0
      const byteCount = data.byte_count ?? 0
      const status = data.status ?? 'EMPTY'
      const changesStatus = data.changes_status ?? null
      const reviewBaseContent = data.review_base_content ?? null
      const lastImproveInstruction = data.last_improve_instruction ?? null

      const stmt = db.prepare(`
        INSERT INTO plan_nodes (
          parent_id, title, position, content,
          type, x, y, user_prompt, system_prompt,
          summary, auto_summary, ai_sync_info, node_type_settings, ai_settings,
          word_count, char_count, byte_count, status,
          changes_status, review_base_content, last_improve_instruction
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
        userPrompt,
        systemPrompt,
        summary,
        autoSummary,
        aiSyncInfo,
        nodeTypeSettings,
        aiSettings,
        wordCount,
        charCount,
        byteCount,
        status,
        changesStatus,
        reviewBaseContent,
        lastImproveInstruction
      )
      return Number(info.lastInsertRowid)
    })
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Update node content and statistics, optionally status.
   */
  updateContent(
    id: number,
    content: string | null,
    options?: {
      wordCount?: number
      charCount?: number
      byteCount?: number
      status?: PlanNodeStatus
    }
  ): void {
    return withDbWrite(db => {
      const wordCount = options?.wordCount ?? (content ? this.countWords(content) : 0)
      const charCount = options?.charCount ?? (content ? this.countChars(content) : 0)
      const byteCount = options?.byteCount ?? (content ? this.countBytes(content) : 0)
      const status = options?.status

      if (status !== undefined) {
        db.prepare(
          `UPDATE plan_nodes SET content = ?, word_count = ?, char_count = ?, byte_count = ?, status = ? WHERE id = ?`
        ).run(content, wordCount, charCount, byteCount, status, id)
      } else {
        db.prepare(`UPDATE plan_nodes SET content = ?, word_count = ?, char_count = ?, byte_count = ? WHERE id = ?`)
          .run(content, wordCount, charCount, byteCount, id)
      }
    })
  }

  /**
   * Update node status only.
   */
  updateStatus(id: number, status: PlanNodeStatus): void {
    return withDbWrite(db => {
      db.prepare('UPDATE plan_nodes SET status = ? WHERE id = ?').run(status, id)
    })
  }

  /**
   * Update multiple fields of a node.
   * The fields object can contain any column of plan_nodes.
   * Returns the number of rows changed.
   */
  update(id: number, fields: PlanNodeUpdate): number {
    return withDbWrite(db => {
      const keys = Object.keys(fields) as (keyof typeof fields)[]
      if (keys.length === 0) return 0
      const setClause = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => fields[k])
      const stmt = db.prepare(`UPDATE plan_nodes SET ${setClause} WHERE id = ?`)
      const info = stmt.run(...values, id)
      return info.changes
    })
  }

  /**
   * Update summary and auto_summary.
   */
  updateSummary(id: number, summary: string | null, autoSummary: number): void {
    return withDbWrite(db => {
      db.prepare('UPDATE plan_nodes SET summary = ?, auto_summary = ? WHERE id = ?')
        .run(summary, autoSummary, id)
    })
  }

  /**
   * Update node position.
   */
  updatePosition(id: number, position: number): void {
    return withDbWrite(db => {
      db.prepare('UPDATE plan_nodes SET position = ? WHERE id = ?').run(position, id)
    })
  }

  /**
   * Update parent_id.
   */
  updateParent(id: number, parentId: number | null): void {
    return withDbWrite(db => {
      db.prepare('UPDATE plan_nodes SET parent_id = ? WHERE id = ?').run(parentId, id)
    })
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  /**
   * Delete a node by ID (cascades to edges via foreign key, children via parent_id).
   */
  delete(id: number): void {
    return withDbWrite(db => {
      db.prepare('DELETE FROM plan_nodes WHERE id = ?').run(id)
    })
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private countWords(text: string): number {
    const t = text.trim()
    return t === '' ? 0 : t.split(/\s+/).length
  }

  private countChars(text: string): number {
    return [...text].length
  }

  private countBytes(text: string): number {
    return Buffer.byteLength(text, 'utf8')
  }
}