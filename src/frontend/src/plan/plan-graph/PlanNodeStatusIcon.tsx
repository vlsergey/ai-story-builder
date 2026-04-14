import React from "react"
import { FileText, CheckCircle2, Edit, AlertTriangle, XCircle, RefreshCwIcon } from "lucide-react"
import type { PlanNodeStatus } from "../../../../shared/plan-graph.js"

const STATUS_ICONS = {
  EMPTY: FileText,
  GENERATING: RefreshCwIcon,
  GENERATED: CheckCircle2,
  MANUAL: Edit,
  OUTDATED: AlertTriangle,
  ERROR: XCircle,
} as const

const STATUS_COLORS = {
  EMPTY: "text-muted-foreground bg-muted",
  GENERATING: "text-green-800 bg-green-100 dark:text-green-200 dark:bg-green-900",
  GENERATED: "text-green-800 bg-green-100 dark:text-green-200 dark:bg-green-900",
  MANUAL: "text-blue-800 bg-blue-100 dark:text-blue-200 dark:bg-blue-900",
  OUTDATED: "text-orange-800 bg-orange-100 dark:text-orange-200 dark:bg-orange-900",
  ERROR: "text-red-800 bg-red-100 dark:text-red-200 dark:bg-red-900",
} as const

interface PlanNodeStatusIconProps {
  status: PlanNodeStatus
  size?: number
  className?: string
  showTooltip?: boolean
}

export default function PlanNodeStatusIcon({
  status,
  size = 14,
  className = "",
  showTooltip = true,
}: PlanNodeStatusIconProps) {
  const Icon = STATUS_ICONS[status]
  const colorClass = STATUS_COLORS[status]

  if (!Icon) {
    return (
      <div className={`p-1 rounded shrink-0 ${colorClass} ${className}`} title={showTooltip ? status : undefined}>
        <span />
      </div>
    )
  }

  return (
    <div className={`p-1 rounded shrink-0 ${colorClass} ${className}`} title={showTooltip ? status : undefined}>
      <Icon size={size} style={status === "GENERATING" ? { animation: "rotate 1s linear infinite" } : {}} />
    </div>
  )
}
