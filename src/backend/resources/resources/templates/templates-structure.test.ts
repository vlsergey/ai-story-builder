import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectTemplate, TemplateProjectPlanNode, WizardField } from "../../../../shared/project-template.js"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { computeTemplateLayoutWithEntries } from "../../../lib/elk-template-layout.js"
import { applyProjectTemplate } from "../../../projects/apply-project-template.js"

vi.mock("../../../settings/settings-repository.js", () => ({
  SettingsRepository: {
    getProjectTitle: () => "Templates Structure Test",
  },
}))

/**
 * Automated structural checks that every bundled template under this directory
 * must satisfy. These mirror the mechanical rules (sections 4, 5, parts of 1
 * and 6) from TEMPLATE_CHECKS.md — anything checkable without LLM judgement
 * belongs here, not in the manual checklist.
 */

const TEMPLATES_DIR = path.dirname(fileURLToPath(import.meta.url))

// Discover templates synchronously so describe.each can be set up at import time.
const TEMPLATE_FILES = readdirSync(TEMPLATES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()

const INTERNAL_PLAN_NODE_TYPES = new Set<string>(["for-each-input", "for-each-output"])
const PLACEHOLDER_RE = /\{\{([^}]+?)\}\}/g
const WIZARD_VAR_RE = /\$\{([^}]+?)\}/g

interface NodeWithCtx {
  node: TemplateProjectPlanNode
  parent: TemplateProjectPlanNode | null
}

function walkPlanNodes(
  nodes: TemplateProjectPlanNode[] | undefined,
  parent: TemplateProjectPlanNode | null = null,
): NodeWithCtx[] {
  if (!nodes) return []
  const out: NodeWithCtx[] = []
  for (const node of nodes) {
    out.push({ node, parent })
    out.push(...walkPlanNodes(node.children, node))
  }
  return out
}

function extractPlaceholders(lines: string[] | undefined): Set<string> {
  if (!lines) return new Set()
  const joined = lines.join("\n")
  const out = new Set<string>()
  for (const m of joined.matchAll(PLACEHOLDER_RE)) {
    out.add(m[1])
  }
  return out
}

function loadTemplate(name: string): ProjectTemplate {
  return JSON.parse(readFileSync(path.join(TEMPLATES_DIR, name), "utf8")) as ProjectTemplate
}

describe.each(TEMPLATE_FILES)("template %s — structural checks", (file) => {
  const template = loadTemplate(file)
  const allNodes = walkPlanNodes(template.plan?.nodes)

  // ── Shared classifiers used by the prompt-cache discipline tests below ───
  // A node is "dynamic" iff it lives anywhere inside a for-each — its content
  // varies per iteration. "Growing" is a refinement: a merge node whose
  // direct input is a for-each-prev-outputs sibling — its content is the
  // prefix of the next iteration's content (append-only).
  const parentOf = new Map<TemplateProjectPlanNode, TemplateProjectPlanNode | null>()
  for (const { node, parent } of allNodes) parentOf.set(node, parent)
  function insideForEach(n: TemplateProjectPlanNode): boolean {
    let cur: TemplateProjectPlanNode | null = parentOf.get(n) ?? null
    while (cur != null) {
      if (cur.type === "for-each") return true
      cur = parentOf.get(cur) ?? null
    }
    return false
  }
  function directSiblings(n: TemplateProjectPlanNode): TemplateProjectPlanNode[] {
    const p = parentOf.get(n) ?? null
    return allNodes.filter(({ node }) => (parentOf.get(node) ?? null) === p).map(({ node }) => node)
  }
  const allNodeTitles = new Set<string>(allNodes.map(({ node }) => node.title))
  const dynamicTitles = new Set<string>(
    allNodes.filter(({ node }) => insideForEach(node)).map(({ node }) => node.title),
  )
  const growingTitles = new Set<string>(
    allNodes
      .filter(({ node }) => {
        if (node.type !== "merge") return false
        const sibs = directSiblings(node)
        return (node.inputs ?? []).some((inp) => {
          const src = sibs.find((s) => s.title === inp.sourceNodeTitle)
          return src?.type === "for-each-prev-outputs"
        })
      })
      .map(({ node }) => node.title),
  )

  function gatherPromptFields(node: TemplateProjectPlanNode): Array<{ field: string; lines: string[] }> {
    const out: Array<{ field: string; lines: string[] }> = []
    if (Array.isArray(node.aiUserInstructions))
      out.push({ field: "aiUserInstructions", lines: node.aiUserInstructions })
    const s = node.nodeTypeSettings as Record<string, unknown> | undefined
    for (const k of [
      "aiUserInstructionsToFindProblems",
      "aiUserInstructionsToFixProblems",
      "aiSystemInstructionsToFindProblems",
      "aiSystemInstructionsToFixProblems",
    ]) {
      const v = s?.[k]
      if (Array.isArray(v) && v.every((x): x is string => typeof x === "string")) {
        out.push({ field: k, lines: v as string[] })
      }
    }
    return out
  }

  /** First-occurrence offset for every node-title placeholder in a prompt. */
  function placeholderPositions(lines: string[]): Map<string, number> {
    const joined = lines.join("\n")
    const out = new Map<string, number>()
    for (const m of joined.matchAll(PLACEHOLDER_RE)) {
      if (!allNodeTitles.has(m[1])) continue // skip virtual vars like foundProblemsTemplate
      if (!out.has(m[1])) out.set(m[1], m.index ?? 0)
    }
    return out
  }

  describe("split nodes have partDescription", () => {
    const splitNodes = allNodes.filter(({ node }) => node.type === "split")
    if (splitNodes.length === 0) {
      it.skip("no split nodes in this template", () => {})
    }
    it.each(
      splitNodes.map(({ node }) => [node.title]),
    )("split node %s declares nodeTypeSettings.partDescription", (title) => {
      const node = splitNodes.find((n) => n.node.title === title)!.node
      const desc = (node.nodeTypeSettings as { partDescription?: unknown } | undefined)?.partDescription
      expect(typeof desc, `${title}: partDescription must be a non-empty string`).toBe("string")
      expect((desc as string).trim().length, `${title}: partDescription must be non-empty`).toBeGreaterThan(0)
    })
  })

  // For text / split / lore / fix-problems, an input edge only matters if the
  // node's prompt actually substitutes the source via `{{Title}}`. An edge
  // without a matching placeholder is a dead wire — the engine never injects
  // the source content into the prompt automatically, so the LLM only sees
  // the instruction with nothing to operate on.
  describe("LLM-call node inputs are referenced via {{Title}} in at least one prompt field", () => {
    const llmCallTypes = new Set(["text", "split", "lore", "fix-problems"])
    const candidates = allNodes.filter(({ node }) => llmCallTypes.has(node.type))
    if (candidates.length === 0) {
      it.skip("no LLM-call nodes in this template", () => {})
    }

    function collectPromptFields(node: TemplateProjectPlanNode): string[] {
      const fields: string[] = []
      if (node.aiUserInstructions) fields.push(node.aiUserInstructions.join("\n"))
      if (node.type === "fix-problems") {
        const nts = (node.nodeTypeSettings ?? {}) as Record<string, unknown>
        const find = nts.aiUserInstructionsToFindProblems as string[] | undefined
        const fix = nts.aiUserInstructionsToFixProblems as string[] | undefined
        if (find) fields.push(find.join("\n"))
        if (fix) fields.push(fix.join("\n"))
      }
      return fields
    }

    const cases: Array<[string, string]> = []
    for (const { node } of candidates) {
      for (const input of node.inputs ?? []) {
        if (input.type !== "text") continue
        cases.push([node.title, input.sourceNodeTitle])
      }
    }
    if (cases.length === 0) {
      it.skip("no text-input edges on LLM-call nodes", () => {})
    }

    it.each(cases)("%s references its input {{%s}}", (consumerTitle, sourceTitle) => {
      const consumer = candidates.find((n) => n.node.title === consumerTitle)!.node
      const allPromptText = collectPromptFields(consumer).join("\n")
      expect(
        allPromptText.includes(`{{${sourceTitle}}}`),
        `${consumerTitle} has an input edge from "${sourceTitle}" but never references {{${sourceTitle}}} in any prompt field. ` +
          `The engine does NOT auto-inject input content into prompts; without {{Title}} substitution the LLM never sees the source.`,
      ).toBe(true)
    })
  })

  describe("every {{Title}} placeholder has a matching input edge", () => {
    for (const { node } of allNodes) {
      const collected = new Set<string>()
      const inputs = new Set((node.inputs ?? []).map((i) => i.sourceNodeTitle))

      // text-style nodes: aiUserInstructions
      for (const p of extractPlaceholders(node.aiUserInstructions)) collected.add(p)

      // fix-problems: find/fix prompts, plus foundProblemsTemplate as known-internal
      const nts = (node.nodeTypeSettings ?? {}) as Record<string, unknown>
      if (node.type === "fix-problems") {
        for (const p of extractPlaceholders(nts.aiUserInstructionsToFindProblems as string[] | undefined))
          collected.add(p)
        for (const p of extractPlaceholders(nts.aiUserInstructionsToFixProblems as string[] | undefined))
          collected.add(p)
        // foundProblemsTemplate is the bare name of a self-supplied placeholder
        // (the engine wraps it in {{...}} when injecting). Tolerate both bare
        // and accidentally-wrapped forms — strip the wrapping if present.
        const tpl = nts.foundProblemsTemplate
        if (typeof tpl === "string") {
          const bareName = tpl.replace(/^\{\{/, "").replace(/\}\}$/, "")
          collected.delete(bareName)
        }
      }

      // split: also has aiUserInstructions
      // (already covered above)

      for (const placeholder of collected) {
        it(`${node.title}: {{${placeholder}}} has a matching input edge`, () => {
          expect(
            inputs.has(placeholder),
            `Node "${node.title}" references "{{${placeholder}}}" but has no input with sourceNodeTitle "${placeholder}".`,
          ).toBe(true)
        })
      }
    }
  })

  // Each {{Title}} substitutes the full content of that node into the prompt.
  // Multiple inline mentions duplicate that content (often kilobytes) in
  // hard-to-read places. Author intent is almost always «refer to the section»,
  // which should use plain text («секция ## Title», «в Title») without
  // placeholder syntax. Real intentional repeats (e.g. short index values)
  // are rare; we err on the strict side and let exceptions be explicit.
  describe("each {{Title}} placeholder appears at most once per prompt field", () => {
    interface PromptFieldCase {
      label: string
      text: string
    }
    const cases: PromptFieldCase[] = []
    for (const { node } of allNodes) {
      const fields: Array<{ field: string; lines: string[] }> = []
      if (Array.isArray(node.aiUserInstructions)) {
        fields.push({ field: "aiUserInstructions", lines: node.aiUserInstructions })
      }
      const s = node.nodeTypeSettings as Record<string, unknown> | undefined
      for (const k of [
        "aiUserInstructionsToFindProblems",
        "aiUserInstructionsToFixProblems",
        "aiSystemInstructionsToFindProblems",
        "aiSystemInstructionsToFixProblems",
      ]) {
        const v = s?.[k]
        if (Array.isArray(v) && v.every((x): x is string => typeof x === "string")) {
          fields.push({ field: k, lines: v as string[] })
        }
      }
      for (const { field, lines } of fields) {
        cases.push({ label: `${node.title} / ${field}`, text: lines.join("\n") })
      }
    }
    if (cases.length === 0) {
      it.skip("no prompt fields in this template", () => {})
    }

    it.each(cases.map(({ label }) => [label]))("%s — placeholders appear at most once", (label) => {
      const text = cases.find((c) => c.label === label)!.text
      const counts = new Map<string, number>()
      for (const m of text.matchAll(PLACEHOLDER_RE)) {
        const name = m[1]
        if (!allNodeTitles.has(name)) continue // skip virtual vars
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      const dups = [...counts.entries()].filter(([_, c]) => c > 1)
      const report = dups.map(([name, c]) => `  - {{${name}}}: ${c}×`).join("\n")
      expect(
        dups,
        `${label}: each {{Title}} substitutes the full content of that node into the prompt. ` +
          `Multiple inline mentions duplicate kilobytes of content. Replace duplicate references with plain-text section names ` +
          `(e.g. «секция \`## Сеттинг\`» instead of «\`{{Сеттинг}}\`»). Offenders:\n${report}`,
      ).toEqual([])
    })
  })

  describe("fix-problems has find and fix prompts", () => {
    const fixNodes = allNodes.filter(({ node }) => node.type === "fix-problems")
    if (fixNodes.length === 0) {
      it.skip("no fix-problems nodes in this template", () => {})
    }
    it.each(
      fixNodes.map(({ node }) => [node.title]),
    )("fix-problems node %s declares both find- and fix-prompt arrays", (title) => {
      const node = fixNodes.find((n) => n.node.title === title)!.node
      const nts = (node.nodeTypeSettings ?? {}) as Record<string, unknown>
      const find = nts.aiUserInstructionsToFindProblems
      const fix = nts.aiUserInstructionsToFixProblems
      expect(
        Array.isArray(find) && (find as string[]).length > 0,
        `${title}: missing aiUserInstructionsToFindProblems`,
      ).toBe(true)
      expect(
        Array.isArray(fix) && (fix as string[]).length > 0,
        `${title}: missing aiUserInstructionsToFixProblems`,
      ).toBe(true)
    })
  })

  describe("every for-each has a for-each-input child", () => {
    const forEachNodes = allNodes.filter(({ node }) => node.type === "for-each")
    if (forEachNodes.length === 0) {
      it.skip("no for-each nodes in this template", () => {})
    }
    it.each(
      forEachNodes.map(({ node }) => [node.title]),
    )("for-each %s has at least one for-each-input child", (title) => {
      const node = forEachNodes.find((n) => n.node.title === title)!.node
      const inputs = (node.children ?? []).filter((c) => c.type === "for-each-input")
      expect(inputs.length, `${title}: must have ≥1 for-each-input child`).toBeGreaterThan(0)
    })
  })

  describe("every for-each-output has exactly one incoming text edge", () => {
    const outputs = allNodes.filter(({ node }) => node.type === "for-each-output")
    if (outputs.length === 0) {
      it.skip("no for-each-output nodes in this template", () => {})
    }
    it.each(
      outputs.map(({ node }) => [node.title]),
    )("for-each-output %s has exactly one text-typed input edge", (title) => {
      const node = outputs.find((n) => n.node.title === title)!.node
      const inputs = (node.inputs ?? []).filter((i) => i.type === "text")
      expect(inputs.length, `${title}: must have exactly one incoming text edge`).toBe(1)
    })
  })

  describe("fix-problems foundProblemsTemplate is a bare name and is referenced in fix prompt", () => {
    const fixNodes = allNodes.filter(({ node }) => node.type === "fix-problems")
    if (fixNodes.length === 0) {
      it.skip("no fix-problems nodes in this template", () => {})
    }
    it.each(
      fixNodes.map(({ node }) => [node.title]),
    )("fix-problems %s — foundProblemsTemplate is a bare name (no {{ }}) and {{<name>}} appears in the fix prompt", (title) => {
      const node = fixNodes.find((n) => n.node.title === title)!.node
      const nts = (node.nodeTypeSettings ?? {}) as Record<string, unknown>
      const tpl = nts.foundProblemsTemplate as string | undefined
      if (tpl === undefined) {
        // Optional — without foundProblemsTemplate the fix prompt simply
        // doesn't inject the problem list. That's allowed.
        return
      }
      // Must be a bare placeholder name. The runtime wraps it in `{{...}}`
      // itself when building replacements; storing it already wrapped
      // produces `{{{{name}}}}` which never matches anything.
      expect(
        tpl.includes("{") || tpl.includes("}"),
        `${title}: foundProblemsTemplate must be a bare name (e.g. "Найденные проблемы"), without surrounding {{ }}. Got: "${tpl}"`,
      ).toBe(false)

      const expectedPlaceholder = `{{${tpl}}}`
      const fixPrompt = (nts.aiUserInstructionsToFixProblems as string[] | undefined)?.join("\n") ?? ""
      expect(
        fixPrompt.includes(expectedPlaceholder),
        `${title}: fix prompt must reference the found-problems placeholder as ${expectedPlaceholder}, but it's absent`,
      ).toBe(true)
    })
  })

  it("plan titles are globally unique (excluding for-each-input/output)", () => {
    const seen = new Map<string, number>()
    for (const { node } of allNodes) {
      if (INTERNAL_PLAN_NODE_TYPES.has(node.type)) continue
      const count = (seen.get(node.title) ?? 0) + 1
      seen.set(node.title, count)
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([t, n]) => `"${t}" ×${n}`)
    expect(duplicates, `duplicate plan titles: ${duplicates.join(", ")}`).toEqual([])
  })

  it("for-each-index nodes have globally unique titles", () => {
    const indexes = allNodes.filter(({ node }) => node.type === "for-each-index")
    const titles = indexes.map(({ node }) => node.title)
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i)
    expect(dupes, `for-each-index titles must be globally unique; duplicates: ${dupes.join(", ")}`).toEqual([])
  })

  it("every wizard variable used in content/aiUserInstructions has a matching wizard field declaration", () => {
    const wizardNames = new Set((template.wizardPages ?? []).flatMap((p) => p.fields.map((f) => f.name)))
    // `${...}` content may be a bare identifier OR an arithmetic expression
    // (e.g. `${round(1400/partsCount)}` — see normalizeAndReplaceContent).
    // For each `${expr}`, extract identifier tokens that look like variable
    // references — anything NOT followed by `(` (which would be a function
    // call into expr-eval's built-ins like round/floor/min/max).
    const IDENT_NOT_CALL_RE = /\b[A-Za-z_$][A-Za-z0-9_$]*\b(?!\s*\()/g
    const used = new Set<string>()
    for (const { node } of allNodes) {
      const all = [...(node.content ?? []), ...(node.aiUserInstructions ?? [])].join("\n")
      for (const m of all.matchAll(WIZARD_VAR_RE)) {
        const inner = m[1].trim()
        for (const im of inner.matchAll(IDENT_NOT_CALL_RE)) used.add(im[0])
      }
    }
    const missing = [...used].filter((v) => !wizardNames.has(v))
    expect(missing, `wizard variables used but not declared: ${missing.join(", ")}`).toEqual([])
  })

  describe("wizard fields are fully populated", () => {
    const fields = (template.wizardPages ?? []).flatMap((p) => p.fields.map((f) => ({ ...f, page: p.id })))
    if (fields.length === 0) {
      it.skip("no wizard fields in this template", () => {})
    }
    it.each(
      fields.map((f) => [`${f.page}.${f.name}`, f]),
    )("wizard field %s has non-empty label and description", (_id, field) => {
      const f = field as { type: string; label?: string; description?: string; placeholder?: string }
      expect(f.label?.trim() ?? "", "label").not.toBe("")
      expect(f.description?.trim() ?? "", "description").not.toBe("")
      // `placeholder` is meaningful for text inputs/textareas but not for
      // typed selects (the options ARE the prompt).
      if (f.type === "input" || f.type === "textarea") {
        expect(f.placeholder?.trim() ?? "", "placeholder").not.toBe("")
      }
    })
  })

  // ─── Coordinate freshness — author hasn't forgotten to run layout ────────
  // Adding/removing nodes or edges shifts the ELK-computed layout. If the
  // stored coordinates diverge from what layout-templates would produce now,
  // someone forgot to run `npm run layout-templates` after a structural edit.
  describe("coordinates match what the layout script would produce now", () => {
    it("running layout would produce a no-op (template author ran layout-templates after the last structural change)", async () => {
      const entries = await computeTemplateLayoutWithEntries(template)
      const drifted: string[] = []
      for (const { node, expected } of entries) {
        const oldX = node.x ?? 0
        const oldY = node.y ?? 0
        const oldW = node.width
        const oldH = node.height
        if (expected.x !== oldX || expected.y !== oldY || expected.width !== oldW || expected.height !== oldH) {
          drifted.push(
            `${node.title}: stored=(${oldX},${oldY},${oldW},${oldH}), expected=(${expected.x},${expected.y},${expected.width},${expected.height})`,
          )
        }
      }
      expect(
        drifted,
        `${drifted.length} node(s) have stale coordinates. Run \`npm run layout-templates\` to refresh.\n` +
          drifted.slice(0, 10).join("\n"),
      ).toEqual([])
    })
  })

  // ─── Prompt cache discipline — dynamic placeholders must be at the bottom ─
  // Provider prompt caches match the prefix of identical requests. The first
  // place where two iterations' prompts diverge breaks the cache from there
  // on. So any placeholder that varies per iteration (anything that's filled
  // by a for-each-input, a per-iteration for-each-output, or by another node
  // that itself sits inside the same for-each) must come AFTER all
  // project-wide placeholders within the same prompt.
  //
  // Rule applied here: for every LLM-call node inside (or downstream from) a
  // for-each, the for-each's input-alias placeholder — by template convention
  // titled "Персонаж" / similar local title — must appear strictly LATER in
  // the prompt than any project-level placeholder it references. Concretely:
  // if the prompt mentions both {{<for-each-input alias>}} and any
  // project-level placeholder X (set once per project, e.g. wizard fields),
  // X must come first.
  describe("dynamic per-iteration placeholders sit below project-wide placeholders", () => {
    const offenders: string[] = []
    for (const { node } of allNodes) {
      for (const { field, lines } of gatherPromptFields(node)) {
        const proj: Array<[string, number]> = []
        const dyn: Array<[string, number]> = []
        for (const [name, pos] of placeholderPositions(lines)) {
          ;(dynamicTitles.has(name) ? dyn : proj).push([name, pos])
        }
        if (proj.length === 0 || dyn.length === 0) continue
        const earliestDyn = Math.min(...dyn.map(([, p]) => p))
        const latestProj = Math.max(...proj.map(([, p]) => p))
        if (earliestDyn < latestProj) {
          const dynName = dyn.find(([, p]) => p === earliestDyn)![0]
          const projName = proj.find(([, p]) => p === latestProj)![0]
          offenders.push(
            `${node.title}.${field}: dynamic {{${dynName}}} appears before project-wide {{${projName}}} — breaks prompt-cache prefix`,
          )
        }
      }
    }
    it("no dynamic placeholder appears before a project-wide one", () => {
      expect(offenders).toEqual([])
    })
  })

  // ─── Prompt cache discipline (intra-iteration order) ─────────────────────
  // Within a for-each, some placeholders are append-only across iterations —
  // a merge node fed by for-each-prev-outputs is the canonical case: its
  // content on iter N is the prefix of its content on iter N+1. Such
  // placeholders should appear BEFORE other per-iteration-fresh placeholders
  // in the prompt — otherwise a fresh placeholder breaks the cache prefix
  // BEFORE the growing one, and the growing one's prefix gains nothing.
  //
  // The cost of getting this wrong is real: in fiction-arc «Проза сцены»
  // had {{План сцены}} (fresh) above {{Сборка предыдущих сцен}} (growing),
  // and observed cached% on text-gen 8k–32k bucket was 5% instead of the
  // 50%+ it would have been with correct order.
  describe("growing (append-only) placeholders precede fresh-per-iter ones", () => {
    const violations: string[] = []
    for (const { node } of allNodes) {
      for (const { field, lines } of gatherPromptFields(node)) {
        const growing: Array<[string, number]> = []
        const fresh: Array<[string, number]> = []
        for (const [name, pos] of placeholderPositions(lines)) {
          if (!dynamicTitles.has(name)) continue // project-wide is the other test's concern
          ;(growingTitles.has(name) ? growing : fresh).push([name, pos])
        }
        if (growing.length === 0 || fresh.length === 0) continue
        const latestGrowing = Math.max(...growing.map(([, p]) => p))
        const earliestFresh = Math.min(...fresh.map(([, p]) => p))
        if (latestGrowing > earliestFresh) {
          const growName = growing.find(([, p]) => p === latestGrowing)![0]
          const freshName = fresh.find(([, p]) => p === earliestFresh)![0]
          violations.push(
            `${node.title}.${field}: growing {{${growName}}} appears after fresh-per-iter {{${freshName}}} — cache prefix breaks at {{${freshName}}} before the growing block contributes`,
          )
        }
      }
    }
    it("no growing placeholder sits below a fresh-per-iter one", () => {
      expect(violations).toEqual([])
    })
  })

  // ─── Age-rating boilerplate ──────────────────────────────────────────────
  // Templates that declare a `select-age-rating` wizard field store the badge
  // label ("G", "PG", "12+", "16+", "18+", "NC-21") under the field's name
  // and substitute it via `${<fieldName>}`. Without that reference somewhere
  // in each LLM-call node's prompt, the LLM has no idea what content range
  // is OK and either (a) refuses on a content filter for risky topics, or
  // (b) over-corrects toward sanitised prose.
  //
  // Rule: if any wizard field has type `select-age-rating`, every LLM-call
  // node's prompts must reference `${<that-field-name>}` at least once.
  describe("LLM-call nodes reference the age-rating wizard var when template has age-rating field", () => {
    const ageRatingFieldNames: string[] = []
    for (const page of template.wizardPages ?? []) {
      for (const f of page.fields) {
        if (f.type === "select-age-rating") ageRatingFieldNames.push(f.name)
      }
    }
    if (ageRatingFieldNames.length === 0) {
      it.skip("template has no age-rating wizard field — rule N/A", () => {})
      return
    }
    const llmCallTypes = new Set(["text", "split", "lore", "fix-problems"])
    const candidates = allNodes.filter(({ node }) => llmCallTypes.has(node.type))
    if (candidates.length === 0) {
      it.skip("no LLM-call nodes in this template", () => {})
      return
    }

    const failures: string[] = []
    for (const { node } of candidates) {
      const fields = gatherPromptFields(node)
      if (fields.length === 0) continue
      for (const { field, lines } of fields) {
        const joined = lines.join("\n")
        const hit = ageRatingFieldNames.some((n) => joined.includes(`\${${n}}`))
        if (!hit) failures.push(`${node.title}.${field}`)
      }
    }
    it("every prompt field of every LLM-call node references the age-rating wizard var", () => {
      const placeholders = ageRatingFieldNames.map((n) => `\${${n}}`).join(" or ")
      expect(
        failures,
        `Missing ${placeholders} reference in: ${failures.join(", ")}. ` +
          `Add the substitution at the top of each prompt (typical pattern: "## Возрастной рейтинг ... ${placeholders}. ..."), ` +
          `or drop the select-age-rating wizard field if rating isn't meaningful for this template.`,
      ).toEqual([])
    })
  })

  // ─── Apply-time check — the whole template applies into a fresh DB ───────
  // Catches things the pure-JSON checks above can't: cross-parent references
  // that don't resolve, fix-problems sourceNodeTitleToFix pointing nowhere,
  // wizard variable substitution blowing up on missing keys, etc.
  describe("applies cleanly into a fresh DB", () => {
    beforeEach(() => {
      setUpTestDb()
    })
    afterEach(() => {
      tearDownTestDb()
    })

    // Numeric fields need a numeric stub so formula substitution
    // (`${round(1400/partsCount)}`) evaluates to a real number instead of NaN.
    function stubFor(f: WizardField): unknown {
      if (f.type === "integer") return f.defaultValue ?? f.min
      return "stub"
    }

    it("apply succeeds with stub wizard data", () => {
      const wizardData = Object.fromEntries(
        (template.wizardPages ?? []).flatMap((p) => p.fields.map((f) => [f.name, stubFor(f)])),
      )
      expect(() => applyProjectTemplate(template, wizardData)).not.toThrow()
    })

    it("fix-problems nodes' prompt fields are strings (not arrays) after apply", async () => {
      const wizardData = Object.fromEntries(
        (template.wizardPages ?? []).flatMap((p) => p.fields.map((f) => [f.name, "stub"])),
      )
      applyProjectTemplate(template, wizardData)

      const { PlanNodeRepository } = await import("../../../plan/nodes/plan-node-repository.js")
      const nodes = new PlanNodeRepository().findAll()
      const fixNodes = nodes.filter((n) => n.type === "fix-problems")
      const failures: string[] = []
      const stringFields = [
        "aiSystemInstructionsToFindProblems",
        "aiSystemInstructionsToFixProblems",
        "aiUserInstructionsToFindProblems",
        "aiUserInstructionsToFixProblems",
      ] as const
      for (const node of fixNodes) {
        const settings = JSON.parse(node.node_type_settings || "{}") as Record<string, unknown>
        for (const field of stringFields) {
          const value = settings[field]
          if (value === undefined) continue
          if (Array.isArray(value)) {
            failures.push(`${node.title} (id=${node.id}): ${field} stored as array, runtime expects string`)
          }
        }
      }
      expect(failures).toEqual([])
    })

    it("nodes whose content is filled from wizard get status MANUAL (not EMPTY)", async () => {
      const wizardData = Object.fromEntries(
        (template.wizardPages ?? []).flatMap((p) => p.fields.map((f) => [f.name, "non-blank stub"])),
      )
      applyProjectTemplate(template, wizardData)

      const { PlanNodeRepository } = await import("../../../plan/nodes/plan-node-repository.js")
      const nodes = new PlanNodeRepository().findAll()
      const failures: string[] = []
      for (const node of nodes) {
        const hasNonBlankContent = node.content != null && node.content.trim().length > 0
        if (hasNonBlankContent && node.status === "EMPTY") {
          failures.push(`${node.title} (id=${node.id}): non-blank content but status=EMPTY`)
        }
      }
      expect(failures).toEqual([])
    })
  })
})
