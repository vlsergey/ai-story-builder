import { useState } from "react"
import { getSmoothStepPath, type EdgeProps } from "@xyflow/react"
import type { EdgeImpl } from "./Types"
import type { PlanEdgeRow } from "@shared/plan-graph"

const EDGE_COLORS: Record<string, string> = {
  text: "#3b82f6", // blue
  textArray: "#3b82f6", // same as text
}

export default function PlanEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<EdgeImpl> & { data: PlanEdgeRow }) {
  const [hovered, setHovered] = useState(false)

  const edgeType = data.type
  const color = EDGE_COLORS[edgeType] ?? EDGE_COLORS.text

  const [edgePath] = getSmoothStepPath({
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
    </>
  )
}
