import React, { useMemo, useState } from 'react'
import * as Diff from 'diff'
import { useLocale } from '../lib/locale'

interface LoreDiffViewProps {
  oldText: string
  newText: string
  /** 'split' = side-by-side read-only; 'unified' = per-hunk accept/reject */
  viewType: 'split' | 'unified'
  /** Called with recomputed content after each hunk decision (unified only) */
  onChange?: (newContent: string) => void
  /** Called once all hunks have been decided (unified only) */
  onAllResolved?: () => void
}

const CONTEXT = 3

// ── Internal types ─────────────────────────────────────────────────────────────

interface NormLine {
  idx: number
  type: 'add' | 'del' | 'eq'
  text: string
  hunkId?: number  // set for 'add'/'del' lines
}

interface Hunk {
  id: number
  /** Indices into normLines for all lines belonging to this hunk's display range */
  displayRange: [number, number]  // [start, end] inclusive
}

// ── Helper: normalize diff output to flat line array ──────────────────────────

function toDiffLines(oldText: string, newText: string): NormLine[] {
  const parts = Diff.diffLines(oldText, newText)
  const lines: NormLine[] = []
  for (const part of parts) {
    const raw = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value
    const splitLines = raw.split('\n')
    for (const text of splitLines) {
      lines.push({
        idx: lines.length,
        type: part.added ? 'add' : part.removed ? 'del' : 'eq',
        text,
      })
    }
  }
  return lines
}

// ── Helper: group changed lines into hunks with context ───────────────────────

function computeHunks(lines: NormLine[]): Hunk[] {
  // Find indices of changed lines
  const changeIdxs = lines
    .filter(l => l.type !== 'eq')
    .map(l => l.idx)

  if (changeIdxs.length === 0) return []

  // Cluster consecutive change indices (merge if gap ≤ 2*CONTEXT)
  const clusters: Array<[number, number]> = []
  let cs = changeIdxs[0], ce = changeIdxs[0]
  for (let i = 1; i < changeIdxs.length; i++) {
    if (changeIdxs[i] - ce <= 2 * CONTEXT) {
      ce = changeIdxs[i]
    } else {
      clusters.push([cs, ce])
      cs = changeIdxs[i]; ce = changeIdxs[i]
    }
  }
  clusters.push([cs, ce])

  // Build hunks: expand each cluster with context
  return clusters.map(([start, end], id) => ({
    id,
    displayRange: [
      Math.max(0, start - CONTEXT),
      Math.min(lines.length - 1, end + CONTEXT),
    ],
  }))
}

// ── Helper: assign hunkId to add/del lines ────────────────────────────────────

function assignHunkIds(lines: NormLine[], hunks: Hunk[]): void {
  for (const hunk of hunks) {
    const [s, e] = hunk.displayRange
    for (let i = s; i <= e; i++) {
      if (lines[i].type !== 'eq') {
        lines[i].hunkId = hunk.id
      }
    }
  }
}

// ── Helper: recompute content after decisions ─────────────────────────────────

function recomputeContent(
  lines: NormLine[],
  decisions: Record<number, 'accepted' | 'rejected'>,
): string {
  const out: string[] = []
  for (const line of lines) {
    if (line.type === 'eq') {
      out.push(line.text)
    } else if (line.type === 'del') {
      const d = line.hunkId !== undefined ? (decisions[line.hunkId] ?? 'accepted') : 'accepted'
      if (d === 'rejected') out.push(line.text)
    } else {
      // 'add'
      const d = line.hunkId !== undefined ? (decisions[line.hunkId] ?? 'accepted') : 'accepted'
      if (d === 'accepted') out.push(line.text)
    }
  }
  return out.join('\n')
}

// ── Split (side-by-side) view ─────────────────────────────────────────────────

function SplitView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = useMemo(() => toDiffLines(oldText, newText), [oldText, newText])

  // Build left (old) and right (new) columns
  const leftLines: Array<{ text: string; removed: boolean }> = []
  const rightLines: Array<{ text: string; added: boolean }> = []

  for (const line of lines) {
    if (line.type === 'del') {
      leftLines.push({ text: line.text, removed: true })
    } else if (line.type === 'add') {
      rightLines.push({ text: line.text, added: true })
    } else {
      leftLines.push({ text: line.text, removed: false })
      rightLines.push({ text: line.text, added: false })
    }
  }

  // Pad shorter column
  while (leftLines.length < rightLines.length) leftLines.push({ text: '', removed: false })
  while (rightLines.length < leftLines.length) rightLines.push({ text: '', added: false })

  return (
    <div className="flex h-full overflow-auto font-mono text-xs">
      {/* Left: old */}
      <div className="flex-1 overflow-x-auto border-r border-border">
        {leftLines.map((l, i) => (
          <div
            key={i}
            className={`px-2 py-0.5 whitespace-pre leading-5 ${l.removed ? 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300' : ''}`}
          >
            {l.removed && <span className="select-none text-red-400 mr-1">-</span>}
            {l.text || <span className="text-transparent">_</span>}
          </div>
        ))}
      </div>
      {/* Right: new */}
      <div className="flex-1 overflow-x-auto">
        {rightLines.map((l, i) => (
          <div
            key={i}
            className={`px-2 py-0.5 whitespace-pre leading-5 ${l.added ? 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300' : ''}`}
          >
            {l.added && <span className="select-none text-green-400 mr-1">+</span>}
            {l.text || <span className="text-transparent">_</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Unified (per-hunk accept/reject) view ─────────────────────────────────────

function UnifiedView({
  oldText,
  newText,
  onChange,
  onAllResolved,
}: {
  oldText: string
  newText: string
  onChange?: (v: string) => void
  onAllResolved?: () => void
}) {
  const { t } = useLocale()
  const [decisions, setDecisions] = useState<Record<number, 'accepted' | 'rejected'>>({})

  const { lines, hunks } = useMemo(() => {
    const ls = toDiffLines(oldText, newText)
    const hs = computeHunks(ls)
    assignHunkIds(ls, hs)
    return { lines: ls, hunks: hs }
  }, [oldText, newText])

  function decide(hunkId: number, decision: 'accepted' | 'rejected') {
    const next = { ...decisions, [hunkId]: decision }
    setDecisions(next)
    const newContent = recomputeContent(lines, next)
    onChange?.(newContent)
    if (hunks.every(h => next[h.id] !== undefined)) {
      onAllResolved?.()
    }
  }

  if (hunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No changes
      </div>
    )
  }

  // Build display: hunk sections separated by collapsed equal sections
  const sections: Array<{ type: 'hunk'; hunk: Hunk } | { type: 'gap'; count: number }> = []

  let pos = 0
  for (const hunk of hunks) {
    const [s] = hunk.displayRange
    if (s > pos) {
      sections.push({ type: 'gap', count: s - pos })
    }
    sections.push({ type: 'hunk', hunk })
    pos = hunk.displayRange[1] + 1
  }
  if (pos < lines.length) {
    sections.push({ type: 'gap', count: lines.length - pos })
  }

  return (
    <div className="h-full overflow-auto font-mono text-xs">
      {sections.map((sec, si) => {
        if (sec.type === 'gap') {
          return (
            <div key={si} className="px-3 py-1 bg-muted/50 text-muted-foreground text-xs border-y border-border/40">
              {sec.count} unchanged line{sec.count !== 1 ? 's' : ''}
            </div>
          )
        }

        const hunk = sec.hunk
        const [s, e] = hunk.displayRange
        const hunkLines = lines.slice(s, e + 1)
        const d = decisions[hunk.id]

        return (
          <div key={si} className="border-y border-border/40">
            {/* Hunk header */}
            <div className="flex items-center gap-2 px-2 py-1 bg-muted/30 border-b border-border/40">
              <span className="text-muted-foreground flex-1 text-xs">Hunk {hunk.id + 1}</span>
              <button
                onClick={() => decide(hunk.id, 'accepted')}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  d === 'accepted'
                    ? 'bg-green-500 text-white'
                    : 'border border-green-500/60 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30'
                }`}
              >
                {t('lore.hunk_accept')}
              </button>
              <button
                onClick={() => decide(hunk.id, 'rejected')}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  d === 'rejected'
                    ? 'bg-red-500 text-white'
                    : 'border border-red-500/60 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                }`}
              >
                {t('lore.hunk_reject')}
              </button>
            </div>

            {/* Lines */}
            {hunkLines.map((line, li) => {
              let bg = ''
              let prefix = ' '
              if (line.type === 'del') {
                bg = d === 'rejected'
                  ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300'
                prefix = '-'
              } else if (line.type === 'add') {
                bg = d === 'accepted'
                  ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300'
                  : 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300'
                prefix = '+'
              }
              return (
                <div key={li} className={`flex px-2 py-0.5 whitespace-pre leading-5 ${bg}`}>
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

export default function LoreDiffView({
  oldText,
  newText,
  viewType,
  onChange,
  onAllResolved,
}: LoreDiffViewProps) {
  if (viewType === 'split') {
    return <SplitView oldText={oldText} newText={newText} />
  }
  return (
    <UnifiedView
      oldText={oldText}
      newText={newText}
      onChange={onChange}
      onAllResolved={onAllResolved}
    />
  )
}
