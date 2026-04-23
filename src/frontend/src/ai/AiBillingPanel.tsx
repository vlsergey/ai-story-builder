import { useTranslation } from "react-i18next"
import { trpc } from "../ipcClient"
import { useState } from "react"
import type { ResponseUsage } from "openai/resources/responses/responses.js"

// 1 tick = 1e-10 USD
const USD_PER_TICK = 1e-10

function formatCost(ticks: number | null | undefined): string {
  if (ticks == null) return "—"
  const usd = ticks * USD_PER_TICK
  if (usd === 0) return "$0.00"
  if (usd < 0.000001) return `$${usd.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")}`
  if (usd < 0.001) return `$${usd.toFixed(7)}`
  if (usd < 1) return `$${usd.toFixed(5)}`
  return `$${usd.toFixed(2)}`
}

function timeAgo(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/** xAI management API response: values[0]=usd, values[1]=count */
interface XaiTimeSeries {
  timeSeries?: Array<{
    dataPoints?: Array<{
      values?: number[]
    }>
  }>
}

interface BillingData {
  configured: boolean
  error?: string
  totals?: {
    last_hour?: XaiTimeSeries
    last_24h?: XaiTimeSeries
    last_7d?: XaiTimeSeries
    last_30d?: XaiTimeSeries
  }
}

/** Returns cost in USD from a period response (values[0]). */
function extractCostUsd(period: XaiTimeSeries | undefined): number | null {
  const values = period?.timeSeries?.[0]?.dataPoints?.[0]?.values
  if (!Array.isArray(values) || values[0] == null) return null
  return values[0]
}

function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return "—"
  if (usd === 0) return "$0.00"
  if (usd < 0.000001) return `$${usd.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")}`
  if (usd < 0.001) return `$${usd.toFixed(7)}`
  if (usd < 1) return `$${usd.toFixed(5)}`
  return `$${usd.toFixed(2)}`
}

const POLL_INTERVAL_MS = 60_000

export default function AiBillingPanel() {
  const { t } = useTranslation()
  // Format tokens with unit (e.g., "1,234 tokens")
  function formatTokensWithUnit(n: number | null | undefined): string {
    if (n == null) return "—"
    return `${n.toLocaleString()} ${t("billing.tokens_unit")}`
  }
  const billingUtils = trpc.useUtils().ai.billing
  const billingData = trpc.ai.billing.get.useQuery(undefined, { refetchInterval: POLL_INTERVAL_MS })
  const [lastRequest, setLastRequest] = useState<Partial<ResponseUsage> | null>(null)

  trpc.ai.lastGenerationEvent.subscribe.useSubscription(undefined, {
    onData(data: Partial<ResponseUsage>) {
      setLastRequest(data)
    },
  })

  const periods: Array<{ key: keyof NonNullable<BillingData["totals"]>; label: string }> = [
    { key: "last_hour", label: t("billing.last_hour") },
    { key: "last_24h", label: t("billing.last_24h") },
    { key: "last_7d", label: t("billing.last_7d") },
    { key: "last_30d", label: t("billing.last_30d") },
  ]

  const hasPeriodData = billingData.data?.configured && billingData.data?.totals && !billingData.data?.error

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto text-sm">
      {/* Last request */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-foreground">{t("billing.last_request")}</span>
          {billingData.isLoading && (
            <span className="text-xs text-muted-foreground animate-pulse">{t("billing.updating")}</span>
          )}
        </div>
        {lastRequest != null ? (
          <div className="rounded border border-border bg-muted/30 px-3 py-2 space-y-1">
            {/* <div className="flex justify-between">
              <span className="text-muted-foreground">{t('billing.cost')}</span>
              <span className="font-mono font-semibold text-foreground">{formatCost(lastRequest.costUsdTicks)}</span>
            </div> */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("billing.total_tokens")}</span>
              <span className="font-mono text-foreground">{formatTokensWithUnit(lastRequest.total_tokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground pl-3">{t("billing.input_tokens")}</span>
              <span className="font-mono text-foreground">{formatTokensWithUnit(lastRequest.input_tokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground pl-6">{t("billing.cached")}</span>
              <span className="font-mono text-foreground">
                {formatTokensWithUnit(lastRequest.input_tokens_details?.cached_tokens)}
              </span>
            </div>
            {/* <div className="flex justify-between">
              <span className="text-muted-foreground pl-3">{t('billing.output_tokens')}</span>
              <span className="font-mono text-foreground">{lastRequest.responseBytes != null ? `${lastRequest.responseBytes.toLocaleString()} ${t('billing.bytes')}` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground pl-3"></span>
              <span className="font-mono text-foreground">{lastRequest.responseChars != null ? `${lastRequest.responseChars.toLocaleString()} ${t('billing.chars')}` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground pl-3"></span>
              <span className="font-mono text-foreground">{formatTokensWithUnit(lastRequest.tokensOutput)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground pl-3"></span>
              <span className="font-mono text-foreground">{lastRequest.responseWords != null ? `${lastRequest.responseWords.toLocaleString()} ${t('billing.words')}` : '—'}</span>
            </div>
            {lastRequest.reasoningTokens ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground pl-6">{t('billing.reasoning')}</span>
                <span className="font-mono text-foreground">{formatTokensWithUnit(lastRequest.reasoningTokens)}</span>
              </div>
            ) : <span />}
            <div className="text-xs text-muted-foreground text-right">{timeAgo(lastRequest.timestamp)}</div> */}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{t("billing.no_requests")}</p>
        )}
      </section>

      {/* Period statistics */}
      <section>
        <div className="font-semibold text-foreground mb-1">{t("billing.period_stats")}</div>
        {!billingData.data ? (
          <p className="text-muted-foreground text-xs">{t("billing.loading")}</p>
        ) : !billingData.data.configured ? (
          <p className="text-muted-foreground text-xs">{t("billing.configure_hint")}</p>
        ) : billingData.data.error ? (
          <p className="text-destructive text-xs">
            {t("billing.error")} {billingData.data.error}
          </p>
        ) : hasPeriodData ? (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal pb-1">{t("billing.period")}</th>
                <th className="text-right font-normal pb-1">{t("billing.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(({ key, label }) => {
                const period = billingData.data.totals?.[key] as XaiTimeSeries
                const costUsd = extractCostUsd(period)
                return (
                  <tr key={key} className="border-t border-border/50">
                    <td className="py-1 text-muted-foreground">{label}</td>
                    <td className="py-1 text-right font-mono font-semibold">{formatUsd(costUsd)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-muted-foreground text-xs">{t("billing.no_data")}</p>
        )}
      </section>

      <button
        type="button"
        onClick={() => billingUtils.invalidate()}
        className="mt-auto self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("billing.refresh")}
      </button>
    </div>
  )
}
