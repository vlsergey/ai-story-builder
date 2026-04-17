import type {
  PlanNodeCreate,
  PlanNodeUpdate,
  PlanNodeRow,
  PlanNodeType,
  PlanNodeStatus,
} from "../../../shared/plan-graph.js"
import { withDbWrite, withDbRead } from "../../db/connection.js"
import type { NodeOverride } from "../../../shared/for-each-plan-node.js"

/**
 * Repository for plan_nodes table operations.
 * Encapsulates all SQL queries related to plan nodes.
 * Manages its own database connections.
 */
export class PlanNodeRepository {
  applyForEachNodeIterationToChildren(forEachNodeId: number, overrides: Record<string, NodeOverride>) {
    return withDbWrite((db) => {
      db.prepare(`UPDATE plan_nodes
        SET 
            content    = data.content,
            summary    = data.summary,
            word_count = COALESCE(CAST(data.word_count AS INTEGER), 0),
            char_count = COALESCE(CAST(data.char_count AS INTEGER), 0),
            byte_count = COALESCE(CAST(data.byte_count AS INTEGER), 0),
            status     = COALESCE(data.status, 'EMPTY')
        FROM (
            SELECT 
                CAST(sub.key AS INTEGER) AS target_id,
                sub.value->>'content'    AS content,
                sub.value->>'summary'    AS summary,
                sub.value->>'word_count' AS word_count,
                sub.value->>'char_count' AS char_count,
                sub.value->>'byte_count' AS byte_count,
                sub.value->>'status'     AS status
            FROM plan_nodes
            JOIN json_each(?) AS sub
        ) AS data
        WHERE plan_nodes.id = data.target_id 
          AND plan_nodes.parent_id = ?`).run(JSON.stringify(overrides), forEachNodeId)
    })
  }

  collectForEachNodeIterationContentFromChildren(forEachNodeId: number): Record<string, NodeOverride> {
    return withDbRead((db) => {
      const dbResult = db
        .prepare<number, { overrides_map: string }>(`SELECT json_group_object(
              id, 
              json_object(
                  'content', content,
                  'summary', summary,
                  'word_count', word_count,
                  'char_count', char_count,
                  'byte_count', byte_count,
                  'status', status
              )
          ) AS overrides_map
          FROM plan_nodes
          WHERE parent_id = ?`)
        .get(forEachNodeId)
      return JSON.parse(dbResult?.overrides_map || "{}") as Record<string, NodeOverride>
    })
  }

  /**
   * Get all nodes (full rows) ordered by position, id.
   */
  findAll(): PlanNodeRow[] {
    return withDbRead((db) => db.prepare("SELECT * FROM plan_nodes ORDER BY position, id").all() as PlanNodeRow[])
  }

  /**
   * Get a single node by ID, or undefined if not found.
   */
  findById(id: number): PlanNodeRow | undefined {
    return withDbRead((db) => db.prepare("SELECT * FROM plan_nodes WHERE id = ?").get(id) as PlanNodeRow | undefined)
  }

  findByIds(ids: number[]): (PlanNodeRow | undefined)[] {
    return withDbRead((db) =>
      ids.map((id) => db.prepare("SELECT * FROM plan_nodes WHERE id = ?").get(id) as PlanNodeRow | undefined),
    )
  }

  /**
   * Get nodes by parent ID (for tree building).
   */
  findByParentId(parentId: number | null): PlanNodeRow[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM plan_nodes WHERE parent_id IS ? ORDER BY position, id")
          .all(parentId) as PlanNodeRow[],
    )
  }

  /**
   * Get nodes by parent ID (for tree building).
   */
  findByParentIdAndType(parentId: number | null, type: PlanNodeType): PlanNodeRow[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM plan_nodes WHERE parent_id IS ? AND type IS ? ORDER BY position, id")
          .all(parentId, type) as PlanNodeRow[],
    )
  }

  /**
   * Get the maximum position among children of a given parent.
   * Internal helper that expects a database connection.
   */
  private getMaxPosition(db: import("better-sqlite3").Database, parentId: number | null): number {
    const row = db
      .prepare("SELECT COALESCE(MAX(position), -1) AS max FROM plan_nodes WHERE parent_id IS ?")
      .get(parentId) as { max: number } | undefined
    return row?.max ?? -1
  }

  /**
   * Count total nodes.
   */
  count(): number {
    return withDbRead((db) => {
      const row = db.prepare("SELECT COUNT(*) AS c FROM plan_nodes").get() as { c: number }
      return row.c
    })
  }

  // ─── Insert ──────────────────────────────────────────────────────────────────

  /**
   * Insert a new node with the given fields.
   * Returns the inserted row's ID.
   */
  insert(data: PlanNodeCreate): number {
    return withDbWrite((db) => {
      const parentId = data.parent_id ?? null
      const position = data.position ?? this.getMaxPosition(db, parentId) + 1
      const type = data.type ?? "text"
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
      const status = data.status ?? "EMPTY"
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
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        aiImproveInstruction,
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
  patch(id: number, fields: PlanNodeUpdate): PlanNodeRow {
    return withDbWrite((db) => {
      const keys = Object.keys(fields) as (keyof typeof fields)[]
      if (keys.length === 0) throw Error("Need at least one updated field")

      const setClause = keys.map((k) => `${k} = ?`).join(", ")
      const values = keys.map((k) => fields[k])
      const stmt = db.prepare(`UPDATE plan_nodes SET ${setClause} WHERE id = ? RETURNING *`)
      return stmt.get(...values, id) as PlanNodeRow
    })
  }

  /**
   * Delete a node by ID (cascades to edges via foreign key, children via parent_id).
   */
  delete(id: number): number {
    return withDbWrite((db) => db.prepare("DELETE FROM plan_nodes WHERE id = ?").run(id).changes)
  }

  updateForEachPrevOutputsStatusInsideForEachContent(forEachPlanNodeId: number): number {
    return withDbWrite((db) => {
      const stmt = db.prepare<[number, string, PlanNodeStatus, number]>(`
        UPDATE plan_nodes
        SET content = (
            WITH
            -- 1. Get the current index and parent content once
            source AS (
                SELECT id, content,
                      CAST(json_extract(content, '$.currentIndex') AS INTEGER) as c_idx
                FROM plan_nodes
                WHERE id = ?
            ),
            -- 2. Pre-filter potential target IDs based on type and parent relationship
            target_ids AS (
                SELECT id FROM plan_nodes
                WHERE parent_id = (SELECT id FROM source)
                  AND type = ?
            ),
            -- 3. Iterate through overrides and apply changes to the status
            new_overrides AS (
                SELECT
                    json(
                        json_group_object(
                            kv.key,
                            CASE
                                -- Check if array index > currentIndex AND node ID matches the type criteria
                                WHEN CAST(arr.key AS INTEGER) > (SELECT c_idx FROM source)
                                    AND kv.key IN (SELECT id FROM target_ids)
                                THEN json_set(json(kv.value), '$.status', ?)
                                ELSE json(kv.value)
                            END
                        )
                    ) as obj
                FROM source s,
                    json_each(s.content, '$.overrides') as arr, -- arr.key is the index in the array [0, 1, 2...]
                    json_each(arr.value) as kv                   -- kv.key is the node ID string ("123")
                GROUP BY arr.id -- Regroup entries back into their respective objects
            )
            -- 4. Reassemble the final JSON with the modified overrides array
            SELECT json_set(s.content, '$.overrides', json_group_array(json(no.obj)))
            FROM source s, new_overrides no
        )
        WHERE id = ?`)
      return stmt.run(forEachPlanNodeId, "for-each-prev-outputs", "OUTDATED", forEachPlanNodeId).changes
    })
  }
}
