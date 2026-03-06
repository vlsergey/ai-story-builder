import express, { Request, Response, Router } from 'express'
import { getCurrentDbPath } from '../db/state.js'
import type { AiConfigStore } from '../lib/ai-engine-adapter.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const MANAGEMENT_API_BASE = 'https://management-api.x.ai'

/** Reads Grok management credentials from project settings. */
function readGrokManagementConfig(dbPath: string): { managementKey: string; teamId: string } | null {
  if (!Database) return null
  try {
    const db = new (Database as typeof import('better-sqlite3'))(dbPath, { readonly: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string } | undefined
    db.close()
    if (!row) return null
    const config = JSON.parse(row.value) as AiConfigStore
    const managementKey = config.grok?.management_key?.trim()
    const teamId = config.grok?.team_id?.trim()
    if (!managementKey || !teamId) return null
    return { managementKey, teamId }
  } catch {
    return null
  }
}

/** Fetches usage totals from xAI Management API for a given time window. */
async function fetchUsage(
  managementKey: string,
  teamId: string,
  startTime: Date,
  endTime: Date,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${MANAGEMENT_API_BASE}/v1/billing/teams/${teamId}/usage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${managementKey}`,
      },
      body: JSON.stringify({
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      }),
    }
  )
  if (!response.ok) {
    const err = await response.text()
    throw new Error(`xAI billing API error ${response.status}: ${err}`)
  }
  return await response.json() as Record<string, unknown>
}

const router = express.Router()

// ─── GET /billing ─────────────────────────────────────────────────────────────

router.get('/billing', async (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) {
    return res.json({ configured: false, error: 'no project open' })
  }

  const creds = readGrokManagementConfig(dbPath)
  if (!creds) {
    return res.json({ configured: false })
  }

  const now = new Date()

  const periods: Array<{ key: string; hours: number }> = [
    { key: 'last_hour', hours: 1 },
    { key: 'last_24h', hours: 24 },
    { key: 'last_7d', hours: 24 * 7 },
    { key: 'last_30d', hours: 24 * 30 },
  ]

  try {
    const results = await Promise.all(
      periods.map(async ({ key, hours }) => {
        const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000)
        const data = await fetchUsage(creds.managementKey, creds.teamId, startTime, now)
        return { key, data }
      })
    )

    const totals: Record<string, unknown> = {}
    for (const { key, data } of results) {
      totals[key] = data
    }

    return res.json({ configured: true, totals })
  } catch (e) {
    return res.json({ configured: true, error: String(e), totals: {} })
  }
})

export default router
