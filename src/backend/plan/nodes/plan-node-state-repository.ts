import { randomUUID } from "node:crypto"
import type { PlanNodeState, PlanNodeStateUpdate, PlanNodeStatus } from "../../../shared/plan-graph.js"
import { atOrBelowSql, childPath, type NodePath } from "../../../shared/plan-node-path.js"
import { withDbRead, withDbTransaction, withDbWrite } from "../../db/connection.js"

/** A state row: what node `node_id` produced in the iteration `path` names. */
export interface PlanNodeStateRecord extends PlanNodeState {
  node_id: number
  path: NodePath
}

const newRev = () => randomUUID().slice(0, 13)

/**
 * The columns and values of a new row. A row created without a status is
 * pending — OUTDATED — not the table's EMPTY: a note written into an iteration
 * that never ran must not make it look answered.
 */
function insertion(nodeId: number, path: NodePath, fields: PlanNodeStateUpdate) {
  const keys = Object.keys(fields) as (keyof PlanNodeStateUpdate)[]
  const status = fields.status === undefined ? [["status", "OUTDATED"] as const] : []
  const columns = ["node_id", "path", ...keys, ...status.map(([k]) => k), "rev"]
  const values = [nodeId, path, ...keys.map((k) => fields[k]), ...status.map(([, v]) => v), newRev()]
  return { keys, columns: columns.join(", "), placeholders: columns.map(() => "?").join(", "), values }
}

/**
 * `plan_node_states`: one row per node and iteration. A missing row means the
 * node has not produced anything there yet — pending work, not an empty answer.
 */
export class PlanNodeStateRepository {
  find(nodeId: number, path: NodePath): PlanNodeStateRecord | undefined {
    return withDbRead(
      (db) =>
        db.prepare("SELECT * FROM plan_node_states WHERE node_id = ? AND path = ?").get(nodeId, path) as
          | PlanNodeStateRecord
          | undefined,
    )
  }

  findAll(): PlanNodeStateRecord[] {
    return withDbRead(
      (db) => db.prepare("SELECT * FROM plan_node_states ORDER BY node_id, path").all() as PlanNodeStateRecord[],
    )
  }

  /** Rows at exactly `path`: one iteration, without the ones nested in it. */
  findAtPath(path: NodePath): PlanNodeStateRecord[] {
    return withDbRead(
      (db) =>
        db.prepare("SELECT * FROM plan_node_states WHERE path = ? ORDER BY node_id").all(path) as PlanNodeStateRecord[],
    )
  }

  /** Every row of one node, in every iteration. */
  findForNode(nodeId: number): PlanNodeStateRecord[] {
    return withDbRead(
      (db) =>
        db
          .prepare("SELECT * FROM plan_node_states WHERE node_id = ? ORDER BY path")
          .all(nodeId) as PlanNodeStateRecord[],
    )
  }

  /** Rows at `ancestor` or inside its iterations, optionally of some nodes only. */
  findAtOrBelow(ancestor: NodePath, nodeIds?: number[]): PlanNodeStateRecord[] {
    return withDbRead((db) => {
      const { sql, params } = atOrBelowSql("path", ancestor)
      const byNode = nodeIds ? ` AND node_id IN (${nodeIds.map(() => "?").join(",") || "NULL"})` : ""
      return db
        .prepare(`SELECT * FROM plan_node_states WHERE ${sql}${byNode} ORDER BY node_id, path`)
        .all(...params, ...(nodeIds ?? [])) as PlanNodeStateRecord[]
    })
  }

  /** Writes `fields` at (node, path), creating the row if needed. The row gets a fresh `rev`. */
  upsert(nodeId: number, path: NodePath, fields: PlanNodeStateUpdate): PlanNodeStateRecord {
    return withDbWrite((db) => {
      const { keys, columns, placeholders, values } = insertion(nodeId, path, fields)
      const updates = [...keys, "rev"].map((k) => `${k} = excluded.${k}`).join(", ")
      return db
        .prepare(`
          INSERT INTO plan_node_states (${columns}) VALUES (${placeholders})
          ON CONFLICT (node_id, path) DO UPDATE SET ${updates}
          RETURNING *
        `)
        .get(...values) as PlanNodeStateRecord
    })
  }

  /**
   * Writes `fields` only if the row still carries `expectedRev` — nothing wrote
   * it since the caller read it. Returns null when it moved on or is gone. An
   * empty `expectedRev` means the caller saw no row: the write creates it,
   * unless one appeared meanwhile.
   */
  updateIfUnchanged(
    nodeId: number,
    path: NodePath,
    fields: PlanNodeStateUpdate,
    expectedRev: string,
  ): PlanNodeStateRecord | null {
    return withDbWrite((db) => {
      const keys = Object.keys(fields) as (keyof PlanNodeStateUpdate)[]
      if (expectedRev === "") {
        const { columns, placeholders, values } = insertion(nodeId, path, fields)
        const created = db
          .prepare(
            `INSERT INTO plan_node_states (${columns}) VALUES (${placeholders})
             ON CONFLICT (node_id, path) DO NOTHING RETURNING *`,
          )
          .get(...values) as PlanNodeStateRecord | undefined
        return created ?? null
      }
      const assignments = [...keys, "rev"].map((k) => `${k} = ?`).join(", ")
      const row = db
        .prepare(`UPDATE plan_node_states SET ${assignments} WHERE node_id = ? AND path = ? AND rev = ? RETURNING *`)
        .get(...keys.map((k) => fields[k]), newRev(), nodeId, path, expectedRev) as PlanNodeStateRecord | undefined
      return row ?? null
    })
  }

  /** Moves a node's rows in `from` statuses to `to`, in every iteration. Returns the rows changed. */
  setStatusForNode(nodeId: number, from: PlanNodeStatus[], to: PlanNodeStatus): PlanNodeStateRecord[] {
    return withDbWrite((db) => {
      if (from.length === 0) return []
      return db
        .prepare(
          `UPDATE plan_node_states SET status = ?, rev = ? WHERE node_id = ? AND status IN (${from.map(() => "?").join(",")}) RETURNING *`,
        )
        .all(to, newRev(), nodeId, ...from) as PlanNodeStateRecord[]
    })
  }

  /**
   * A row still GENERATING when a project opens belongs to a run that never
   * ended — the app was closed or crashed. It is pending work, not work in
   * progress. Returns how many rows it found.
   */
  resetInterrupted(): number {
    return withDbWrite(
      (db) =>
        db.prepare("UPDATE plan_node_states SET status = 'OUTDATED', rev = ? WHERE status = 'GENERATING'").run(newRev())
          .changes,
    )
  }

  /** Deletes rows at `ancestor` or below it, optionally of some nodes only. */
  deleteAtOrBelow(ancestor: NodePath, nodeIds?: number[]): number {
    return withDbWrite((db) => {
      const { sql, params } = atOrBelowSql("path", ancestor)
      const byNode = nodeIds ? ` AND node_id IN (${nodeIds.map(() => "?").join(",") || "NULL"})` : ""
      return db.prepare(`DELETE FROM plan_node_states WHERE ${sql}${byNode}`).run(...params, ...(nodeIds ?? [])).changes
    })
  }

  /**
   * Deletes the iterations of loop `containerId` at `containerPath` whose key
   * is `vanished`, with everything nested in them: the elements that are no
   * longer in its list.
   */
  deleteIterationsWhere(containerId: number, containerPath: NodePath, vanished: (key: string) => boolean): number {
    return withDbTransaction((db) => {
      const prefix = childPath(containerPath, containerId, "")
      const rows = db
        .prepare("SELECT DISTINCT path FROM plan_node_states WHERE path >= ? AND path < ?")
        .all(prefix, `${prefix}\uffff`) as { path: string }[]
      const keys = new Set(rows.map(({ path }) => path.slice(prefix.length).split("/")[0]))
      let deleted = 0
      for (const key of keys) {
        if (vanished(key)) deleted += this.deleteAtOrBelow(childPath(containerPath, containerId, key))
      }
      return deleted
    })
  }

  /**
   * Moves an iteration of loop `containerId` at `containerPath` from key `from`
   * to key `to`, with everything nested in it, as a parallel loop does when its
   * keys grow. Every moved row gets a new revision.
   */
  renameIteration(containerId: number, containerPath: NodePath, from: string, to: string): number {
    return withDbWrite((db) => {
      const oldPath = childPath(containerPath, containerId, from)
      const newPath = childPath(containerPath, containerId, to)
      const { sql, params } = atOrBelowSql("path", oldPath)
      return db
        .prepare(`UPDATE plan_node_states SET path = ? || substr(path, ?), rev = ? WHERE ${sql}`)
        .run(newPath, oldPath.length + 1, newRev(), ...params).changes
    })
  }
}
