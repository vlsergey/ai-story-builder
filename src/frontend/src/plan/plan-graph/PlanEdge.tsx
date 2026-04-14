import React, { useState } from "react"
import { getSmoothStepPath, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react"
import { useLocale } from "../../lib/locale"
import { EdgeImpl } from "./Types"
import { PlanEdgeRow } from "@shared/plan-graph"

const EDGE_COLORS: Record<string, string> = {
  text: "#3b82f6", // blue
  textArray: "#3b82f6", // same as text
}

export default function PlanEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<EdgeImpl> & { data: PlanEdgeRow }) {
  const { t } = useLocale()
  const [hovered, setHovered] = useState(false)

  const edgeType = data.type
  const color = EDGE_COLORS[edgeType] ?? EDGE_COLORS.text

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sourceX - 20,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Determine offsets based on edge type
  const isArray = edgeType === "textArray"
  const offsets = isArray ? [-4, 4, 0] : [0]

  const label = data?.label ?? t(`planGraph.edge.${edgeType}`)

  return (
    <>
      {/* Invisible wider hit area for hover/interaction */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: "pointer" }}
      />
      {offsets.map((offset) => {
        // const translateX = normal.x * offset
        // const translateY = normal.y * offset
        const hasArrow = offset === 0
        const pathD =
          offset === 0
            ? edgePath
            : getSmoothStepPath({
                sourceX: sourceX + Math.abs(offset) * 3 + 2 * offset - 20,
                sourceY: sourceY + offset,
                sourcePosition,
                targetX: targetX - Math.abs(offset) * 3,
                targetY: targetY + offset,
                targetPosition,
              })[0]
        return (
          <path
            key={offset}
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={hovered ? 2.5 : 1.5}
            markerEnd={hasArrow ? `url(#arrow-${edgeType})` : undefined}
            style={{ transition: "stroke-width 0.1s" }}
          />
        )
      })}
      {/* Arrowhead markers */}
      <defs>
        {Object.entries(EDGE_COLORS).map(([t, c]) => (
          <marker key={t} id={`arrow-${t}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={c} />
          </marker>
        ))}
      </defs>
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {hovered && (
            <div
              className="px-1.5 py-0.5 rounded text-[10px] font-medium select-none"
              style={{
                background: color + "22",
                border: `1px solid ${color}66`,
                color,
              }}
            >
              {label}
              {data?.onDelete && (
                <button
                  onClick={() => data.onDelete(Number(id))}
                  className="ml-1 text-destructive hover:text-destructive/80 font-bold"
                  title="Delete edge"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
