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
      const keys = Object.keys(fields) as (keyof PlanNodeStateUpdate)[]
      const columns = ["node_id", "path", ...keys, "rev"]
      const updates = [...keys, "rev"].map((k) => `${k} = excluded.${k}`).join(", ")
      return db
        .prepare(`
          INSERT INTO plan_node_states (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
          ON CONFLICT (node_id, path) DO UPDATE SET ${updates}
          RETURNING *
        `)
        .get(nodeId, path, ...keys.map((k) => fields[k]), newRev()) as PlanNodeStateRecord
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
        const columns = ["node_id", "path", ...keys, "rev"]
        const created = db
          .prepare(
            `INSERT INTO plan_node_states (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
             ON CONFLICT (node_id, path) DO NOTHING RETURNING *`,
          )
          .get(nodeId, path, ...keys.map((k) => fields[k]), newRev()) as PlanNodeStateRecord | undefined
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

  /** Deletes rows at `ancestor` or below it, optionally of some nodes only. */
  deleteAtOrBelow(ancestor: NodePath, nodeIds?: number[]): number {
    return withDbWrite((db) => {
      const { sql, params } = atOrBelowSql("path", ancestor)
      const byNode = nodeIds ? ` AND node_id IN (${nodeIds.map(() => "?").join(",") || "NULL"})` : ""
      return db.prepare(`DELETE FROM plan_node_states WHERE ${sql}${byNode}`).run(...params, ...(nodeIds ?? [])).changes
    })
  }

  /**
   * Deletes the iterations of loop `containerId` at `containerPath` from index
   * `from` on, with everything nested in them: the elements that vanished when
   * its list got shorter.
   */
  deleteIterationsFrom(containerId: number, containerPath: NodePath, from: number): number {
    return withDbTransaction((db) => {
      const prefix = childPath(containerPath, containerId, "")
      const rows = db
        .prepare("SELECT DISTINCT path FROM plan_node_states WHERE path >= ? AND path < ?")
        .all(prefix, `${prefix}￿`) as { path: string }[]
      const vanished = new Set<string>()
      for (const { path } of rows) {
        const key = path.slice(prefix.length).split("/")[0]
        if (Number(key) >= from) vanished.add(childPath(containerPath, containerId, key))
      }
      let deleted = 0
      for (const iteration of vanished) deleted += this.deleteAtOrBelow(iteration)
      return deleted
    })
  }
}
