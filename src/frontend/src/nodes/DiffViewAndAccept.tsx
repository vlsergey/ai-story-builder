import { useEffect, useMemo, useRef, useState } from "react"
import * as Diff from "diff"
import { ChevronLeft, ChevronRight, Check, X, WrapText, Pilcrow } from "lucide-react"
import { useTranslation } from "react-i18next"

export interface DiffViewAndAcceptProps {
  oldText: string
  newText: string
  /** 'split' = side-by-side read-only; 'unified' = per-hunk accept/reject */
  viewType: "split" | "unified"
  /** Called when a hunk is rejected — new content with that hunk reverted to old */
  onChange?: (newContent: string) => void
  /** Called when a hunk is accepted — new base with that hunk promoted from new */
  onBaseChange?: (newBase: string) => void
  /** Called once all hunks have been decided */
  onAllResolved?: () => void
}

const CONTEXT = 3

// ── Internal types ─────────────────────────────────────────────────────────────

interface NormLine {
  idx: number
  type: "add" | "del" | "eq"
  text: string
  hunkId?: number // set for 'add'/'del' lines
}

interface Hunk {
  id: number
  /** Indices into normLines for all lines belonging to this hunk's display range */
  displayRange: [number, number] // [start, end] inclusive
}

type Section =
  | { type: "hunk"; hunk: Hunk; hunkIdx: number }
  | { type: "gap"; count: number; startLine: number; sectionIdx: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDiffLines(oldText: string, newText: string, ignoreWhitespace = false): NormLine[] {
  const parts = Diff.diffLines(oldText, newText, { ignoreWhitespace })
  const lines: NormLine[] = []
  for (const part of parts) {
    const raw = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value
    for (const text of raw.split("\n")) {
      lines.push({
        idx: lines.length,
        type: part.added ? "add" : part.removed ? "del" : "eq",
        text,
      })
    }
  }
  return lines
}

function computeHunks(lines: NormLine[]): Hunk[] {
  const changeIdxs = lines.filter((l) => l.type !== "eq").map((l) => l.idx)
  if (changeIdxs.length === 0) return []

  const clusters: Array<[number, number]> = []
  let cs = changeIdxs[0],
    ce = changeIdxs[0]
  for (let i = 1; i < changeIdxs.length; i++) {
    if (changeIdxs[i] - ce <= 2 * CONTEXT) {
      ce = changeIdxs[i]
    } else {
      clusters.push([cs, ce])
      cs = changeIdxs[i]
      ce = changeIdxs[i]
    }
  }
  clusters.push([cs, ce])

  return clusters.map(([start, end], id) => ({
    id,
    displayRange: [Math.max(0, start - CONTEXT), Math.min(lines.length - 1, end + CONTEXT)] as [number, number],
  }))
}

function assignHunkIds(lines: NormLine[], hunks: Hunk[]): void {
  for (const hunk of hunks) {
    const [s, e] = hunk.displayRange
    for (let i = s; i <= e; i++) {
      if (lines[i].type !== "eq") lines[i].hunkId = hunk.id
    }
  }
}

function recomputeContent(lines: NormLine[], decisions: Record<number, "accepted" | "rejected">): string {
  const out: string[] = []
  for (const line of lines) {
    if (line.type === "eq") {
      out.push(line.text)
    } else if (line.type === "del") {
      const d = line.hunkId !== undefined ? (decisions[line.hunkId] ?? "accepted") : "accepted"
      if (d === "rejected") out.push(line.text)
    } else {
      const d = line.hunkId !== undefined ? (decisions[line.hunkId] ?? "accepted") : "accepted"
      if (d === "accepted") out.push(line.text)
    }
  }
  return out.join("\n")
}

function buildSections(hunks: Hunk[], lineCount: number): Section[] {
  const sections: Section[] = []
  let pos = 0
  let sectionIdx = 0
  for (let hi = 0; hi < hunks.length; hi++) {
    const hunk = hunks[hi]
    const [s] = hunk.displayRange
    if (s > pos) {
      sections.push({ type: "gap", count: s - pos, startLine: pos, sectionIdx: sectionIdx++ })
    }
    sections.push({ type: "hunk", hunk, hunkIdx: hi })
    sectionIdx++
    pos = hunk.displayRange[1] + 1
  }
  if (pos < lineCount) {
    sections.push({ type: "gap", count: lineCount - pos, startLine: pos, sectionIdx: sectionIdx++ })
  }
  return sections
}

// Build paired left/right columns for a set of lines (for split view)
function buildSplitColumns(hunkLines: NormLine[]) {
  const left: Array<{ text: string; type: "del" | "eq" | "empty" }> = []
  const right: Array<{ text: string; type: "add" | "eq" | "empty" }> = []
  for (const line of hunkLines) {
    if (line.type === "del") {
      left.push({ text: line.text, type: "del" })
    } else if (line.type === "add") {
      right.push({ text: line.text, type: "add" })
    } else {
      left.push({ text: line.text, type: "eq" })
      right.push({ text: line.text, type: "eq" })
    }
  }
  while (left.length < right.length) left.push({ text: "", type: "empty" })
  while (right.length < left.length) right.push({ text: "", type: "empty" })
  return { left, right }
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

function Toolbar({
  hunkCount,
  currentIdx,
  currentDecision,
  wordWrap,
  ignoreWhitespace,
  onPrev,
  onNext,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onToggleWordWrap,
  onToggleIgnoreWhitespace,
}: {
  hunkCount: number
  currentIdx: number
  currentDecision: "accepted" | "rejected" | undefined
  wordWrap: boolean
  ignoreWhitespace: boolean
  onPrev: () => void
  onNext: () => void
  onAccept: () => void
  onReject: () => void
  onAcceptAll: () => void
  onRejectAll: () => void
  onToggleWordWrap: () => void
  onToggleIgnoreWhitespace: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20 text-xs shrink-0 flex-wrap">
      <button
        type="button"
        onClick={onPrev}
        disabled={currentIdx === 0 || hunkCount === 0}
        className="p-0.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
        title="Previous change"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-muted-foreground min-w-14 text-center tabular-nums">
        {hunkCount === 0 ? "–" : `${currentIdx + 1} / ${hunkCount}`}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={currentIdx >= hunkCount - 1 || hunkCount === 0}
        className="p-0.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
        title="Next change"
      >
        <ChevronRight size={14} />
      </button>

      {hunkCount > 0 && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={onAccept}
            className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors ${
              currentDecision === "accepted"
                ? "bg-green-500 text-white"
                : "border border-green-500/60 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
            }`}
          >
            <Check size={12} />
            {t("lore.hunk_accept")}
          </button>
          <button
            type="button"
            onClick={onReject}
            className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors ${
              currentDecision === "rejected"
                ? "bg-red-500 text-white"
                : "border border-red-500/60 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
            }`}
          >
            <X size={12} />
            {t("lore.hunk_reject")}
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={onAcceptAll}
            className="px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
          >
            {t("lore.accept_all")}
          </button>
          <button
            type="button"
            onClick={onRejectAll}
            className="px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
          >
            {t("lore.reject_all")}
          </button>
        </>
      )}
      <div className="flex-1" />
      <div className="w-px h-4 bg-border mx-1" />
      <button
        type="button"
        onClick={onToggleWordWrap}
        className={`p-0.5 rounded transition-colors ${wordWrap ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
        title="Toggle word wrap"
      >
        <WrapText size={14} />
      </button>
      <button
        type="button"
        onClick={onToggleIgnoreWhitespace}
        className={`p-0.5 rounded transition-colors ${ignoreWhitespace ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
        title="Ignore whitespace"
      >
        <Pilcrow size={14} />
      </button>
    </div>
  )
}

// ── Split (side-by-side) view ─────────────────────────────────────────────────

function SplitView({
  lines,
  hunks,
  currentHunkIdx,
  wordWrap,
  onHunkClick,
}: {
  lines: NormLine[]
  hunks: Hunk[]
  currentHunkIdx: number
  wordWrap: boolean
  onHunkClick: (idx: number) => void
}) {
  const { t } = useTranslation()
  const hunkRefs = useRef<(HTMLDivElement | null)[]>([])
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set())

  useEffect(() => {
    hunkRefs.current[currentHunkIdx]?.scrollIntoView?.({ behavior: "smooth", block: "nearest" })
  }, [currentHunkIdx])

  if (hunks.length === 0) {
    return <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">No changes</div>
  }

  const sections = buildSections(hunks, lines.length)
  const wsCls = wordWrap ? "whitespace-pre-wrap" : "whitespace-pre"

  return (
    <div className="flex-1 overflow-auto font-mono text-xs">
      {sections.map((sec) => {
        if (sec.type === "gap") {
          const isExpanded = expandedGaps.has(sec.sectionIdx)
          if (isExpanded) {
            const gapLines = lines.slice(sec.startLine, sec.startLine + sec.count)
            const { left, right } = buildSplitColumns(gapLines)
            return (
              <div key={sec.sectionIdx} className="flex">
                <div className="flex-1 border-r border-border">
                  {left.map((l, i) => (
                    <div key={i} className={`px-2 py-0.5 ${wsCls} leading-5`}>
                      {l.text || <span className="text-transparent">_</span>}
                    </div>
                  ))}
                </div>
                <div className="flex-1">
                  {right.map((l, i) => (
                    <div key={i} className={`px-2 py-0.5 ${wsCls} leading-5`}>
                      {l.text || <span className="text-transparent">_</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          return (
            <button
              type="button"
              key={sec.sectionIdx}
              onClick={() => setExpandedGaps((s) => new Set([...s, sec.sectionIdx]))}
              className="w-full px-3 py-1 bg-muted/50 text-muted-foreground text-xs border-y border-border/40 hover:bg-muted transition-colors text-left"
            >
              {t("lore.expand_lines")} ({sec.count})
            </button>
          )
        }

        const { hunk, hunkIdx } = sec
        const [s, e] = hunk.displayRange
        const hunkLines = lines.slice(s, e + 1)
        const isCurrent = hunkIdx === currentHunkIdx

        const { left, right } = buildSplitColumns(hunkLines)
        return (
          <div
            key={hunk.id}
            ref={(el) => {
              hunkRefs.current[hunkIdx] = el
            }}
            onClick={() => onHunkClick(hunkIdx)}
            className={`border-y transition-colors cursor-pointer border-l-4 ${
              isCurrent
                ? "border-l-blue-500 border-blue-300/50 dark:border-blue-600/50 bg-blue-50/40 dark:bg-blue-950/20"
                : "border-l-transparent border-border/40"
            }`}
          >
            <div className="flex">
              <div className={`flex-1 border-r border-border ${wordWrap ? "" : "overflow-x-auto"}`}>
                {left.map((l, i) => (
                  <div
                    key={i}
                    className={`px-2 py-0.5 ${wsCls} leading-5 ${
                      l.type === "del" ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300" : ""
                    }`}
                  >
                    {l.type === "del" && <span className="select-none text-red-400 mr-1">-</span>}
                    {l.text || <span className="text-transparent">_</span>}
                  </div>
                ))}
              </div>
              <div className={`flex-1 ${wordWrap ? "" : "overflow-x-auto"}`}>
                {right.map((l, i) => (
                  <div
                    key={i}
                    className={`px-2 py-0.5 ${wsCls} leading-5 ${
                      l.type === "add" ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300" : ""
                    }`}
                  >
                    {l.type === "add" && <span className="select-none text-green-400 mr-1">+</span>}
                    {l.text || <span className="text-transparent">_</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Unified (per-hunk accept/reject) view ─────────────────────────────────────

function UnifiedView({
  lines,
  hunks,
  currentHunkIdx,
  wordWrap,
  onDecide,
  onHunkClick,
}: {
  lines: NormLine[]
  hunks: Hunk[]
  currentHunkIdx: number
  wordWrap: boolean
  onDecide: (hunkId: number, decision: "accepted" | "rejected") => void
  onHunkClick: (idx: number) => void
}) {
  const { t } = useTranslation()
  const hunkRefs = useRef<(HTMLDivElement | null)[]>([])
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set())

  useEffect(() => {
    hunkRefs.current[currentHunkIdx]?.scrollIntoView?.({ behavior: "smooth", block: "nearest" })
  }, [currentHunkIdx])

  if (hunks.length === 0) {
    return <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">No changes</div>
  }

  const sections = buildSections(hunks, lines.length)
  const wsCls = wordWrap ? "whitespace-pre-wrap" : "whitespace-pre"

  return (
    <div className="flex-1 overflow-auto font-mono text-xs">
      {sections.map((sec) => {
        if (sec.type === "gap") {
          const isExpanded = expandedGaps.has(sec.sectionIdx)
          if (isExpanded) {
            const gapLines = lines.slice(sec.startLine, sec.startLine + sec.count)
            return (
              <div key={sec.sectionIdx}>
                {gapLines.map((line, li) => (
                  <div key={li} className={`flex px-2 py-0.5 ${wsCls} leading-5`}>
                    <span className="w-4 shrink-0 select-none text-muted-foreground"> </span>
                    <span>{line.text}</span>
                  </div>
                ))}
              </div>
            )
          }
          return (
            <button
              type="button"
              key={sec.sectionIdx}
              onClick={() => setExpandedGaps((s) => new Set([...s, sec.sectionIdx]))}
              className="w-full px-3 py-1 bg-muted/50 text-muted-foreground text-xs border-y border-border/40 hover:bg-muted transition-colors text-left"
            >
              {t("lore.expand_lines")} ({sec.count})
            </button>
          )
        }

        const { hunk, hunkIdx } = sec
        const [s, e] = hunk.displayRange
        const hunkLines = lines.slice(s, e + 1)
        const isCurrent = hunkIdx === currentHunkIdx

        return (
          <div
            key={hunk.id}
            ref={(el) => {
              hunkRefs.current[hunkIdx] = el
            }}
            className={`border-y transition-colors border-l-4 ${
              isCurrent
                ? "border-l-blue-500 border-blue-300/50 dark:border-blue-600/50 bg-blue-50/40 dark:bg-blue-950/20"
                : "border-l-transparent border-border/40"
            }`}
          >
            {/* Hunk header */}
            <div
              onClick={() => onHunkClick(hunkIdx)}
              className="flex items-center gap-2 px-2 py-1 border-b border-border/40 cursor-pointer bg-muted/30"
            >
              <span
                className={`flex-1 text-xs ${isCurrent ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-muted-foreground"}`}
              >
                {t("lore.hunk_label")} {hunkIdx + 1}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDecide(hunk.id, "accepted")
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors border border-green-500/60 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
              >
                <Check size={10} />
                {t("lore.hunk_accept")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDecide(hunk.id, "rejected")
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors border border-red-500/60 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <X size={10} />
                {t("lore.hunk_reject")}
              </button>
            </div>

            {/* Lines */}
            {hunkLines.map((line, li) => {
              let bg = ""
              let prefix = " "
              if (line.type === "del") {
                bg = "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                prefix = "-"
              } else if (line.type === "add") {
                bg = "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300"
                prefix = "+"
              }
              return (
                <div key={li} className={`flex px-2 py-0.5 ${wsCls} leading-5 ${bg}`}>
                  <span className="w-4 shrink-0 select-none text-muted-foreground">{prefix}</span>
                  <span>{line.text}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function DiffViewAndAccept({
  oldText,
  newText,
  viewType,
  onChange,
  onBaseChange,
  onAllResolved,
}: DiffViewAndAcceptProps) {
  const [wordWrap, setWordWrap] = useState(false)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)

  const { lines, hunks } = useMemo(() => {
    const ls = toDiffLines(oldText, newText, ignoreWhitespace)
    const hs = computeHunks(ls)
    assignHunkIds(ls, hs)
    return { lines: ls, hunks: hs }
  }, [oldText, newText, ignoreWhitespace])

  const [currentHunkIdx, setCurrentHunkIdx] = useState(0)

  // Keep currentHunkIdx in bounds when hunks count changes (after parent updates texts)
  useEffect(() => {
    if (hunks.length === 0) return
    setCurrentHunkIdx((i) => Math.min(i, hunks.length - 1)) // eslint-disable-line react-hooks/set-state-in-effect
  }, [hunks.length])

  function goToPrev() {
    setCurrentHunkIdx((i) => Math.max(0, i - 1))
  }

  function goToNext() {
    setCurrentHunkIdx((i) => Math.min(hunks.length - 1, i + 1))
  }

  function decide(hunkId: number, decision: "accepted" | "rejected") {
    const hunkIdx = hunks.findIndex((h) => h.id === hunkId)
    if (decision === "accepted") {
      // Promote this hunk's new lines into oldText — diff will no longer show it
      const newBase = recomputeContent(
        lines,
        Object.fromEntries(hunks.map((h) => [h.id, h.id === hunkId ? "accepted" : "rejected"])),
      )
      onBaseChange?.(newBase)
    } else {
      // Revert this hunk's new lines in newText — diff will no longer show it
      const newContent = recomputeContent(
        lines,
        Object.fromEntries(hunks.map((h) => [h.id, h.id === hunkId ? "rejected" : "accepted"])),
      )
      onChange?.(newContent)
    }
    // Auto-advance; keep in bounds (hunks will shrink after parent re-renders)
    setCurrentHunkIdx(Math.min(hunkIdx + 1, hunks.length - 1))
    if (hunks.length === 1) onAllResolved?.()
  }

  function acceptAll() {
    onBaseChange?.(newText) // old becomes new → no diff
    onAllResolved?.()
  }

  function rejectAll() {
    onChange?.(oldText) // new becomes old → no diff
    onAllResolved?.()
  }

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        hunkCount={hunks.length}
        currentIdx={currentHunkIdx}
        currentDecision={undefined}
        wordWrap={wordWrap}
        ignoreWhitespace={ignoreWhitespace}
        onPrev={goToPrev}
        onNext={goToNext}
        onAccept={() => hunks.length > 0 && decide(hunks[currentHunkIdx].id, "accepted")}
        onReject={() => hunks.length > 0 && decide(hunks[currentHunkIdx].id, "rejected")}
        onAcceptAll={acceptAll}
        onRejectAll={rejectAll}
        onToggleWordWrap={() => setWordWrap((v) => !v)}
        onToggleIgnoreWhitespace={() => setIgnoreWhitespace((v) => !v)}
      />
      {viewType === "split" ? (
        <SplitView
          lines={lines}
          hunks={hunks}
          currentHunkIdx={currentHunkIdx}
          wordWrap={wordWrap}
          onHunkClick={setCurrentHunkIdx}
        />
      ) : (
        <UnifiedView
          lines={lines}
          hunks={hunks}
          currentHunkIdx={currentHunkIdx}
          wordWrap={wordWrap}
          onDecide={decide}
          onHunkClick={setCurrentHunkIdx}
        />
      )}
    </div>
  )
}
