import React, { useEffect, useRef, useState } from 'react'
import { AI_CALL_COMPLETED_EVENT, type AiCallCompletedDetail } from '../lib/billing-events'
import { useLocale } from '../lib/locale'

// 1 tick = 1e-10 USD
const USD_PER_TICK = 1e-10

function formatCost(ticks: number | null | undefined): string {
  if (ticks == null) return '—'
  const usd = ticks * USD_PER_TICK
  if (usd === 0) return '$0.00'
  if (usd < 0.000001) return `$${usd.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')}`
  if (usd < 0.001) return `$${usd.toFixed(7)}`
  if (usd < 1) return `$${usd.toFixed(5)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

function timeAgo(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface LastRequest {
  costUsdTicks?: number
  tokensInput?: number
  tokensOutput?: number
  timestamp: string
}

interface PeriodTotals {
  cost_usd_ticks?: number | null
  [key: string]: unknown
}

interface BillingData {
  configured: boolean
  error?: string
  totals?: {
    last_hour?: PeriodTotals
    last_24h?: PeriodTotals
    last_7d?: PeriodTotals
    last_30d?: PeriodTotals
  }
}

/** Tries to extract total cost_usd_ticks from whatever shape the xAI API returns for a period. */
function extractCost(period: PeriodTotals | undefined): number | null {
  if (!period) return null
  if (typeof period.cost_usd_ticks === 'number') return period.cost_usd_ticks
  const total = period.total as Record<string, unknown> | undefined
  if (total && typeof total.cost_usd_ticks === 'number') return total.cost_usd_ticks
  return null
}

/** Tries to extract call count from a period. */
function extractCalls(period: PeriodTotals | undefined): number | null {
  if (!period) return null
  if (typeof period.call_count === 'number') return period.call_count
  if (typeof period.count === 'number') return period.count
  const items = period.items as unknown[]
  if (Array.isArray(items)) return items.length
  return null
}

const POLL_INTERVAL_MS = 60_000

export default function AiBillingPanel() {
  const { t } = useLocale()
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null)
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchBilling() {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/billing')
      const data = await res.json() as BillingData
      setBilling(data)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  function schedulePoll() {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = setTimeout(() => {
      void fetchBilling().then(schedulePoll)
    }, POLL_INTERVAL_MS)
  }

  useEffect(() => {
    void fetchBilling().then(schedulePoll)
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AiCallCompletedDetail>).detail
      setLastRequest({
        costUsdTicks: detail.costUsdTicks,
        tokensInput: detail.tokensInput,
        tokensOutput: detail.tokensOutput,
        timestamp: new Date().toISOString(),
      })
      void fetchBilling().then(schedulePoll)
    }
    window.addEventListener(AI_CALL_COMPLETED_EVENT, handler)
    return () => window.removeEventListener(AI_CALL_COMPLETED_EVENT, handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const periods: Array<{ key: keyof NonNullable<BillingData['totals']>; label: string }> = [
    { key: 'last_hour', label: t('billing.last_hour') },
    { key: 'last_24h',  label: t('billing.last_24h') },
    { key: 'last_7d',   label: t('billing.last_7d') },
    { key: 'last_30d',  label: t('billing.last_30d') },
  ]

  const hasPeriodData = billing?.configured && billing.totals && !billing.error

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto text-sm">
      {/* Last request */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-foreground">{t('billing.last_request')}</span>
          {loading && <span className="text-xs text-muted-foreground animate-pulse">{t('billing.updating')}</span>}
        </div>
        {lastRequest != null ? (
          <div className="rounded border border-border bg-muted/30 px-3 py-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('billing.cost')}</span>
              <span className="font-mono font-semibold text-foreground">{formatCost(lastRequest.costUsdTicks)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('billing.input_tokens')}</span>
              <span className="font-mono text-foreground">{formatTokens(lastRequest.tokensInput)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('billing.output_tokens')}</span>
              <span className="font-mono text-foreground">{formatTokens(lastRequest.tokensOutput)}</span>
            </div>
            <div className="text-xs text-muted-foreground text-right">{timeAgo(lastRequest.timestamp)}</div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{t('billing.no_requests')}</p>
        )}
      </section>

      {/* Period statistics */}
      <section>
        <div className="font-semibold text-foreground mb-1">{t('billing.period_stats')}</div>
        {!billing ? (
          <p className="text-muted-foreground text-xs">{t('billing.loading')}</p>
        ) : !billing.configured ? (
          <p
            className="text-muted-foreground text-xs"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: t('billing.configure_hint') }}
          />
        ) : billing.error ? (
          <p className="text-destructive text-xs">{t('billing.error')} {billing.error}</p>
        ) : hasPeriodData ? (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal pb-1">{t('billing.period')}</th>
                <th className="text-right font-normal pb-1">{t('billing.calls')}</th>
                <th className="text-right font-normal pb-1">{t('billing.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(({ key, label }) => {
                const period = billing.totals?.[key]
                const cost = extractCost(period)
                const calls = extractCalls(period)
                return (
                  <tr key={key} className="border-t border-border/50">
                    <td className="py-1 text-muted-foreground">{label}</td>
                    <td className="py-1 text-right font-mono">{calls != null ? calls : '—'}</td>
                    <td className="py-1 text-right font-mono font-semibold">{formatCost(cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-muted-foreground text-xs">{t('billing.no_data')}</p>
        )}
      </section>

      <button
        onClick={() => void fetchBilling().then(schedulePoll)}
        className="mt-auto self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t('billing.refresh')}
      </button>
    </div>
  )
}
