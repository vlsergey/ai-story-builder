import type { Database } from "better-sqlite3"

/**
 * Convert legacy regex-based split nodes to LLM-driven splits.
 *
 * Old shape: `plan_nodes.node_type_settings` JSON `{ separator, dropFirst, dropLast }`
 *            with `ai_user_prompt` unused.
 * New shape: `plan_nodes.ai_user_prompt` holds a natural-language instruction
 *            describing how to split; `node_type_settings` is cleared.
 *
 * The translator tries to recognize a few common regex patterns and writes a
 * friendly prompt for them. Anything unknown falls back to a faithful prompt
 * that quotes the original regex. Existing `ai_user_prompt` is preserved (we
 * append the translation on a new line rather than overwriting) so manual
 * tweaks aren't lost.
 *
 * Affected rows are marked OUTDATED so the user knows to re-run them — the
 * regex split was deterministic, the LLM split needs a regeneration to take
 * effect.
 */
export default function migration(db: Database): void {
  const rows = db
    .prepare(
      `SELECT id, ai_user_prompt, node_type_settings, status
         FROM plan_nodes
        WHERE type = 'split'`,
    )
    .all() as Array<{
    id: number
    ai_user_prompt: string | null
    node_type_settings: string | null
    status: string
  }>

  const update = db.prepare(
    `UPDATE plan_nodes
        SET ai_user_prompt = @ai_user_prompt,
            node_type_settings = NULL,
            status = CASE WHEN status IN ('EMPTY', 'MANUAL') THEN status ELSE 'OUTDATED' END
      WHERE id = @id`,
  )

  for (const row of rows) {
    let parsedSettings: { separator?: unknown; dropFirst?: unknown; dropLast?: unknown } = {}
    if (row.node_type_settings) {
      try {
        parsedSettings = JSON.parse(row.node_type_settings)
      } catch {
        // ignore; treat as empty
      }
    }
    const separator = typeof parsedSettings.separator === "string" ? parsedSettings.separator : ""
    const dropFirst = toNonNegInt(parsedSettings.dropFirst)
    const dropLast = toNonNegInt(parsedSettings.dropLast)

    const translated = translateRegexToPrompt(separator, dropFirst, dropLast)
    const combined =
      row.ai_user_prompt && row.ai_user_prompt.trim().length > 0 ? `${row.ai_user_prompt}\n\n${translated}` : translated

    update.run({ id: row.id, ai_user_prompt: combined })
  }
}

function toNonNegInt(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0
  return Math.floor(v)
}

function translateRegexToPrompt(separator: string, dropFirst: number, dropLast: number): string {
  const lines: string[] = []

  // Trailing whitespace inside the separator can be semantically meaningful
  // (e.g. `^## ` separates Markdown h2 lines, not just any `^##`). Only use
  // trim() for the emptiness check, not for pattern recognition.
  if (separator.trim() === "") {
    lines.push("Split the input text into logical parts. Each part should be a self-contained piece.")
  } else if (/^\^#{1,6}\s/.test(separator)) {
    lines.push("Split the input by Markdown headings. Each section under one heading is one part.")
  } else if (/^\^?\\d\+\\\.\s?/.test(separator) || /\\d\+\\\.\s/.test(separator)) {
    lines.push("Split the input into items of a numbered list. Each numbered item is one part.")
  } else if (separator === "\\n\\n" || separator === "\\n\\s*\\n" || separator === "\n\n") {
    lines.push("Split the input by paragraphs (blank-line separators). Each paragraph is one part.")
  } else if (/^\^?-{3,}\$?$/.test(separator.trim())) {
    lines.push("Split the input at lines that contain only dashes (`---`). The text between dividers is one part.")
  } else {
    lines.push(
      `Split the input using the pattern matching this regular expression as a guideline: \`${separator}\`. Each piece between matches is one part.`,
    )
  }

  if (dropFirst > 0) {
    lines.push(`Then drop the first ${dropFirst} resulting part${dropFirst === 1 ? "" : "s"}.`)
  }
  if (dropLast > 0) {
    lines.push(`Then drop the last ${dropLast} resulting part${dropLast === 1 ? "" : "s"}.`)
  }

  return lines.join(" ")
}
