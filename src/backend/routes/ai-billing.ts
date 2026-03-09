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
    const managementKey = (config.grok as any)?.management_key?.trim()
    const teamId = (config.grok as any)?.team_id?.trim()
    if (!managementKey || !teamId) return null
    return { managementKey, teamId }
  } catch {
    return null
  }
}

/** Formats a Date as "YYYY-MM-DD HH:MM:SS" in UTC (xAI billing API format). */
function formatBillingDate(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

/** Fetches usage totals from xAI Management API for a given time window. */
async function fetchUsage(
  managementKey: string,
  teamId: string,
  startTime: Date,
  endTime: Date,
): Promise<Record<string, unknown>> {
  const requestBody = {
    analyticsRequest: {
      timeRange: {
        startTime: formatBillingDate(startTime),
        endTime: formatBillingDate(endTime),
        timezone: 'Etc/GMT',
      },
      timeUnit: 'TIME_UNIT_NONE',
      values: [
        { name: 'usd', aggregation: 'AGGREGATION_SUM' },
      ],
      groupBy: [],
      filters: [],
    },
  }
  console.log('[billing] request:', JSON.stringify(requestBody))
  const response = await fetch(
    `${MANAGEMENT_API_BASE}/v1/billing/teams/${teamId}/usage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${managementKey}`,
      },
      body: JSON.stringify(requestBody),
    }
  )
  const responseText = await response.text()
  console.log(`[billing] response ${response.status}:`, responseText)
  if (!response.ok) {
    throw new Error(`xAI billing API error ${response.status}: ${responseText}`)
  }
  return JSON.parse(responseText) as Record<string, unknown>
}

export async function getAiBilling(): Promise<{
  configured: boolean
  error?: string
  totals?: Record<string, unknown>
}> {
  const dbPath = getCurrentDbPath()
  if (!dbPath) {
    return { configured: false, error: 'no project open' }
  }

  const creds = readGrokManagementConfig(dbPath)
  if (!creds) {
    return { configured: false }
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

    return { configured: true, totals }
  } catch (e) {
    return { configured: true, error: String(e), totals: {} }
  }
}
