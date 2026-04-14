import { withDbRead, withDbWrite } from "../db/connection.js"
import type { LoreNodeCreate, LoreNodeRow, LoreNodeUpdate } from "../../shared/lore-node.js"

/**
 * Repository for lore_nodes table operations.
 * Encapsulates all SQL queries related to lore nodes.
 */
export class LoreNodeRepository {
  /**
   * Get all lore nodes (full rows) ordered by parent_id, position, id.
   */
  findAll(): LoreNodeRow[] {
    return withDbRead(
      (db) => db.prepare("SELECT * FROM lore_nodes ORDER BY parent_id, position, id").all() as LoreNodeRow[],
    )
  }

  /**
   * Get a single node by ID, or undefined if not found.
   */
  getById(id: number): LoreNodeRow | undefined {
    return withDbRead((db) => db.prepare("SELECT * FROM lore_nodes WHERE id = ?").get(id) as LoreNodeRow | undefined)
  }

  /**
   * Get nodes by parent ID (for tree building).
   */
  getByParentId(parentId: number | null): LoreNodeRow[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM lore_nodes WHERE parent_id IS ? ORDER BY position, id")
          .all(parentId) as LoreNodeRow[],
    )
  }

  /**
   * Get all lore nodes that have non‑null ai_sync_info and are not marked for deletion.
   */
  getAllWithAiSyncInfo(): LoreNodeRow[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM lore_nodes WHERE ai_sync_info IS NOT NULL AND to_be_deleted = 0 ORDER BY id")
          .all() as LoreNodeRow[],
    )
  }

  /**
   * Count total lore nodes.
   */
  count(): number {
    return withDbRead((db) => {
      const row = db.prepare("SELECT COUNT(*) AS c FROM lore_nodes").get() as { c: number }
      return row.c
    })
  }

  /**
   * Get the maximum position among children of a given parent.
   * Returns -1 if there are no children.
   */
  getMaxPosition(parentId: number | null): number {
    return withDbRead((db) => {
      const row = db
        .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM lore_nodes WHERE parent_id IS ?")
        .get(parentId) as { m: number }
      return row.m
    })
  }

  /**
   * Reorder children by assigning new positions based on the given order of IDs.
   * The IDs must belong to the same parent (caller's responsibility).
   */
  reorderChildren(childIds: number[]): void {
    withDbWrite((db) => {
      const update = db.prepare("UPDATE lore_nodes SET position = ? WHERE id = ?")
      db.transaction(() => {
        childIds.forEach((id, i) => update.run(i, id))
      })()
    })
  }

  /**
   * Mark a node and all its descendants for deletion (to_be_deleted = 1).
   */
  markForDeletionRecursive(id: number): LoreNodeRow[] {
    return withDbWrite((db) =>
      db
        .prepare<number, LoreNodeRow>(`
        WITH RECURSIVE sub AS (
          SELECT id FROM lore_nodes WHERE id = ?
          UNION ALL
          SELECT n.id FROM lore_nodes n INNER JOIN sub s ON n.parent_id = s.id
        )
        UPDATE lore_nodes SET to_be_deleted = 1 WHERE id IN (SELECT id FROM sub) RETURNING *
      `)
        .all(id),
    )
  }

  /**
   * Restore a node and all its descendants from deletion (to_be_deleted = 0).
   */
  restoreRecursive(id: number): LoreNodeRow[] {
    return withDbWrite((db) =>
      db
        .prepare<number, LoreNodeRow>(`
        WITH RECURSIVE sub AS (
          SELECT id FROM lore_nodes WHERE id = ?
          UNION ALL
          SELECT n.id FROM lore_nodes n INNER JOIN sub s ON n.parent_id = s.id
        )
        UPDATE lore_nodes SET to_be_deleted = 0 WHERE id IN (SELECT id FROM sub) RETURNING *
      `)
        .all(id),
    )
  }

  /**
   * Sort children of a node by name (case‑insensitive) and update their positions.
   * Returns the number of sorted children.
   */
  sortChildrenByName(parentId: number | null): number {
    return withDbWrite((db) => {
      const children = db
        .prepare("SELECT id FROM lore_nodes WHERE parent_id IS ? ORDER BY name COLLATE NOCASE ASC")
        .all(parentId) as { id: number }[]
      const update = db.prepare("UPDATE lore_nodes SET position = ? WHERE id = ?")
      db.transaction(() => {
        children.forEach((c, i) => update.run(i, c.id))
      })()
      return children.length
    })
  }

  /**
   * Get a node's parent_id and to_be_deleted flag.
   */
  getNodeInfo(id: number): { parent_id: number | null; to_be_deleted: number } | undefined {
    return withDbRead(
      (db) =>
        db.prepare("SELECT parent_id, to_be_deleted FROM lore_nodes WHERE id = ?").get(id) as
          | { parent_id: number | null; to_be_deleted: number }
          | undefined,
    )
  }

  /**
   * Check if a node exists and is not marked for deletion.
   */
  existsAndNotDeleted(id: number): boolean {
    return withDbRead((db) => {
      const row = db.prepare("SELECT 1 FROM lore_nodes WHERE id = ? AND to_be_deleted = 0").get(id) as
        | { "1": number }
        | undefined
      return !!row
    })
  }

  /**
   * Get the parent chain to detect cycles.
   */
  getParentChain(startId: number): number[] {
    return withDbRead((db) => {
      const chain: number[] = []
      let current: number | null = startId
      const getParent = db.prepare("SELECT parent_id FROM lore_nodes WHERE id = ?")
      while (current !== null) {
        const row = getParent.get(current) as { parent_id: number | null } | undefined
        if (!row) break
        current = row.parent_id
        if (current !== null) chain.push(current)
      }
      return chain
    })
  }

  /**
   * Duplicate a node (copy its parent_id, name, content) with a new name.
   * Returns the ID of the new node.
   */
  duplicate(id: number): number {
    return withDbWrite((db) => {
      const src = db.prepare("SELECT parent_id, name, content FROM lore_nodes WHERE id = ?").get(id) as
        | { parent_id: number | null; name: string; content: string | null }
        | undefined
      if (!src) throw new Error("Node not found")

      const baseName = `${src.name} copy`
      const existing = db
        .prepare("SELECT name FROM lore_nodes WHERE parent_id IS ? AND name LIKE ? || '%'")
        .all(src.parent_id, baseName) as { name: string }[]
      const usedNames = new Set(existing.map((r) => r.name))
      let newName = baseName
      let n = 2
      while (usedNames.has(newName)) newName = `${baseName} ${n++}`

      let info
      if (src.content) {
        const wordCount = (src.content.match(/\S+/g) || []).length
        const charCount = [...src.content].length
        const byteCount = Buffer.byteLength(src.content, "utf8")
        info = db
          .prepare(
            "INSERT INTO lore_nodes (parent_id, name, content, word_count, char_count, byte_count) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(src.parent_id, newName, src.content, wordCount, charCount, byteCount)
      } else {
        info = db.prepare("INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)").run(src.parent_id, newName)
      }
      return Number(info.lastInsertRowid)
    })
  }

  /**
   * Insert a new lore node.
   * Returns the inserted row's ID.
   */
  insert(data: LoreNodeCreate & { id?: number }): number {
    return withDbWrite((db) => {
      const hasId = data.id !== undefined
      const columns = [
        "parent_id",
        "title",
        "content",
        "position",
        "status",
        "to_be_deleted",
        "ai_sync_info",
        "word_count",
        "char_count",
        "byte_count",
        "ai_user_prompt",
        "ai_system_prompt",
        "ai_settings",
      ]
      const placeholders = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"]
      if (hasId) {
        columns.unshift("id")
        placeholders.unshift("?")
      }
      const stmt = db.prepare(`
        INSERT INTO lore_nodes (${columns.join(", ")})
        VALUES (${placeholders.join(", ")})
      `)
      const params = [
        ...(hasId ? [data.id] : []),
        data.parent_id ?? null,
        data.title,
        data.content ?? null,
        data.position ?? 0,
        data.status ?? "ACTIVE",
        data.to_be_deleted ?? 0,
        data.ai_sync_info ?? null,
        data.word_count ?? 0,
        data.char_count ?? 0,
        data.byte_count ?? 0,
        data.ai_user_prompt ?? null,
        data.ai_system_prompt ?? null,
        data.ai_settings ?? null,
      ]
      const info = stmt.run(...params)
      return Number(info.lastInsertRowid)
    })
  }

  /**
   * Update multiple fields of a lore node.
   * The fields object can contain any column of lore_nodes.
   * Returns the number of rows changed.
   */
  update(id: number, fields: LoreNodeUpdate): number {
    return withDbWrite((db) => {
      const keys = Object.keys(fields) as (keyof typeof fields)[]
      if (keys.length === 0) return 0
      const setClause = keys.map((k) => `${k} = ?`).join(", ")
      const values = keys.map((k) => fields[k])
      const stmt = db.prepare(`UPDATE lore_nodes SET ${setClause} WHERE id = ?`)
      const info = stmt.run(...values, id)
      return info.changes
    })
  }

  /**
   * Delete a node by ID (cascades to children via foreign key).
   */
  delete(id: number) {
    return withDbWrite((db) => {
      db.prepare("DELETE FROM lore_nodes WHERE id = ?").run(id).changes
    })
  }

  /**
   * Delete all nodes marked for deletion (to_be_deleted = 1).
   */
  deleteMarkedForDeletion() {
    return withDbWrite((db) => {
      db.prepare("DELETE FROM lore_nodes WHERE to_be_deleted = 1").run().changes
    })
  }
}
