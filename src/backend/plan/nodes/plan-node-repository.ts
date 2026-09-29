import type {
  PlanNodeDefinition,
  PlanNodeDefinitionCreate,
  PlanNodeDefinitionUpdate,
} from "../../../shared/plan-graph.js"
import type { PlanNodeType } from "../../../shared/plan-node-types.js"
import { withDbRead, withDbWrite } from "../../db/connection.js"

/**
 * Node definitions — what a node is. What it produced lives in
 * `plan_node_states`, per iteration of its loops; see PlanNodeStateRepository.
 */
export class PlanNodeRepository {
  /** All definitions, ordered by position, id. */
  findAll(): PlanNodeDefinition[] {
    return withDbRead(
      (db) => db.prepare("SELECT * FROM plan_nodes ORDER BY position, id").all() as PlanNodeDefinition[],
    )
  }

  findById(id: number): PlanNodeDefinition | undefined {
    return withDbRead(
      (db) => db.prepare("SELECT * FROM plan_nodes WHERE id = ?").get(id) as PlanNodeDefinition | undefined,
    )
  }

  findByParentId(parentId: number | null): PlanNodeDefinition[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM plan_nodes WHERE parent_id IS ? ORDER BY position, id")
          .all(parentId) as PlanNodeDefinition[],
    )
  }

  findByParentIdAndType(parentId: number | null, type: PlanNodeType): PlanNodeDefinition[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM plan_nodes WHERE parent_id IS ? AND type IS ? ORDER BY position, id")
          .all(parentId, type) as PlanNodeDefinition[],
    )
  }

  private getMaxPosition(db: import("better-sqlite3").Database, parentId: number | null): number {
    const row = db
      .prepare("SELECT COALESCE(MAX(position), -1) AS max FROM plan_nodes WHERE parent_id IS ?")
      .get(parentId) as { max: number } | undefined
    return row?.max ?? -1
  }

  count(): number {
    return withDbRead((db) => (db.prepare("SELECT COUNT(*) AS c FROM plan_nodes").get() as { c: number }).c)
  }

  /** Inserts a definition; its state is written by the service. Returns the new id. */
  insert(data: PlanNodeDefinitionCreate): number {
    return withDbWrite((db) => {
      const parentId = data.parent_id ?? null
      const info = db
        .prepare(`
          INSERT INTO plan_nodes (parent_id, title, position, type, x, y, width, height, node_type_settings, ai_settings)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          parentId,
          data.title,
          data.position ?? this.getMaxPosition(db, parentId) + 1,
          data.type ?? "text",
          data.x ?? 0,
          data.y ?? 0,
          data.width ?? null,
          data.height ?? null,
          data.node_type_settings ?? null,
          data.ai_settings ?? null,
        )
      return Number(info.lastInsertRowid)
    })
  }

  /** Updates definition fields; returns the updated definition. */
  patch(id: number, fields: PlanNodeDefinitionUpdate): PlanNodeDefinition {
    return withDbWrite((db) => {
      const keys = Object.keys(fields) as (keyof typeof fields)[]
      if (keys.length === 0) throw Error("Need at least one updated field")
      const setClause = keys.map((k) => `${k} = ?`).join(", ")
      const values = keys.map((k) => fields[k])
      return db
        .prepare(`UPDATE plan_nodes SET ${setClause} WHERE id = ? RETURNING *`)
        .get(...values, id) as PlanNodeDefinition
    })
  }

  /** Changes what kind of node it is — only ever done together with moving its state to the new kind's layout. */
  setType(id: number, type: PlanNodeType): void {
    withDbWrite((db) => db.prepare("UPDATE plan_nodes SET type = ? WHERE id = ?").run(type, id))
  }

  /** Deletes a node; its children, edges and states go by foreign key. */
  delete(id: number): number {
    return withDbWrite((db) => db.prepare("DELETE FROM plan_nodes WHERE id = ?").run(id).changes)
  }
}
