# Project templates: export and apply

> Last verified: 2026-05-14. Re-check before relying on file paths and line numbers.

## What templates are for

A project template is a reusable blueprint: a configured plan graph + optional lore folder skeleton + wizard pages. The wizard answers fill `${VARNAME}` placeholders inside `content` and `aiUserInstructions` fields.

Templates ship in two flavors:
- **System templates**: bundled in [`src/backend/resources/resources/templates/`](../../src/backend/resources/resources/templates/). The only one shipped today is [`fiction-arc.ru.json`](../../src/backend/resources/resources/templates/fiction-arc.ru.json).
- **User templates**: written by `exportProjectAsTemplate` to a user-chosen path.

## File format

JSON validated against [`src/schemas/project-template.json`](../../src/schemas/project-template.json). The corresponding TS type is auto-generated to [`src/shared/project-template.ts`](../../src/shared/project-template.ts):

```ts
ProjectTemplate {
  label: string
  description: string
  wizardPages?: WizardPage[]
  lore?: { nodes: TemplateProjectLoreNode[] }
  plan: { nodes: TemplateProjectPlanNode[] }
}

TemplateProjectPlanNode {
  title: string
  type: PlanNodeType
  x?, y?, width?, height?: number
  aiUserInstructions?: string[]       // becomes node_type_settings.userPrompt on apply
  nodeTypeSettings?: Record<string, any>
  content?: string[]                   // wizard ${var} substitution applies
  children?: TemplateProjectPlanNode[]
  inputs?: { sourceNodeTitle: string; type: PlanEdgeType }[]
}
```

No IDs anywhere in the format — references are by title. Containment is structural (`children`).

## Title resolution rules

Set up by commit `7ba71c8`. Apply/export use the same model:

- **Plan titles are globally unique** across the whole template, EXCEPT for `for-each-input` and `for-each-output` (auto-managed by the engine, share fixed "Input"/"Output" labels across multiple for-each containers — exempt).
- `for-each-index` is **not** exempt — must have a unique title even when used in multiple for-eachs (e.g. fiction-arc uses "Номер сцены" and "Номер сцены второго драфта").
- Edge `sourceNodeTitle` resolves: **sibling-first**, then **global flat lookup**. Sibling lookup is what keeps for-each-internal references (Input → siblings) working without renaming.
- `nodeTypeSettings.sourceNodeTitleToFix` on `fix-problems` uses the same resolution.
- Lore: sibling-unique within parent (matches the SQL constraint on `lore_nodes`).

## Export: from running project to JSON

[`src/backend/projects/export-project-as-template.ts`](../../src/backend/projects/export-project-as-template.ts):

1. Validates global plan-title uniqueness (excluding for-each-input/output) — `checkPlanTitlesGloballyUnique`.
2. Builds each `TemplateProjectPlanNode` from a DB row. `node_type_settings.userPrompt` is pulled OUT into `aiUserInstructions` (newline-split into a `string[]`); `systemPrompt` stays inside `nodeTypeSettings` (no template-level field for it yet). For `fix-problems`, `sourceNodeIdToFix` → `sourceNodeTitleToFix` via `idToTitle`.
3. Wires children via `parent_id`.
4. Wires edges as `{ sourceNodeTitle, type }` — cross-parent edges are allowed.
5. Lore export: only folder nodes (those with children); leaf content is intentionally dropped.

## Apply: from JSON to a fresh project's DB

[`src/backend/projects/apply-project-template.ts`](../../src/backend/projects/apply-project-template.ts):

1. Validates global plan-title uniqueness (`assertPlanTitlesGloballyUnique`) and sibling-uniqueness on lore.
2. Recursive insert: for each node, write to `plan_nodes` directly via repo (bypasses `service.create`, so for-each auto-create logic does NOT run — for-each-input/output must be in the template).
3. `aiUserInstructions` is merged into `node_type_settings.userPrompt`; `${VARNAME}` placeholders in `content` and `aiUserInstructions` are expanded with wizard answers via `normalizeAndReplaceContent`.
4. Two maps are built as nodes are inserted: `titleByParent` (for sibling lookup) and `titleByTitleGlobal` (for cross-parent fallback). `for-each-input` / `for-each-output` are excluded from the global map.
5. After all nodes exist, edges are inserted using `resolveSource(parentNewId, sourceTitle, byParent, byGlobal)`.
6. After all nodes exist, `fix-problems` nodes get their settings re-patched with translated `sourceNodeIdToFix`.

## Wizard variables

`${VARNAME}` is expanded only in `content` and `aiUserInstructions` ([apply-project-template.ts:142, :129](../../src/backend/projects/apply-project-template.ts)) — NOT in titles or arbitrary `nodeTypeSettings` fields. If a template wants wizard data in `nodeTypeSettings.aiUserInstructionsToFindProblems` of a fix-problems node, that field is NOT currently substituted. Worth a future check if a real template needs it.

## fix-problems prompt shape at apply time

Two non-obvious normalizations happen during apply for `fix-problems` nodes:

- **`string[]` → `string`** (commit `8cf29b4`): the template lists prompt bodies as arrays of lines for readability, e.g. `"aiUserInstructionsToFindProblems": ["...", "..."]`. Apply joins them with `\n` before storing in `node_type_settings`.
- **`{{Foo}}` → `Foo`** for `foundProblemsTemplate` (commit `b89a50f`): template authors naturally write `"foundProblemsTemplate": "{{Found Problems}}"`. Apply strips the wrapping so the stored value is just `"Found Problems"` — the runtime then re-wraps it as a placeholder when needed. The structural check rejects unwrapped use elsewhere.

## Tests

- [`src/backend/projects/template-titles.test.ts`](../../src/backend/projects/template-titles.test.ts) — title-based references, sibling-uniqueness, global-uniqueness, cross-parent edges, round-trips.
- [`src/backend/projects/template-coordinates.test.ts`](../../src/backend/projects/template-coordinates.test.ts) — coordinate persistence (x/y/width/height) + freshness check on bundled templates (commit `6063d0b`).
- [`src/backend/resources/resources/templates/templates-structure.test.ts`](../../src/backend/resources/resources/templates/templates-structure.test.ts) — generic structural lints applied to every bundled template (checklist in [`TEMPLATE_CHECKS.md`](../../src/backend/resources/resources/templates/TEMPLATE_CHECKS.md)).
- [`src/backend/resources/resources/templates/fiction-arc.diagnostic.test.ts`](../../src/backend/resources/resources/templates/fiction-arc.diagnostic.test.ts) — fiction-arc-specific diagnostics (fix-problems source resolution, for-each-index multiplicity, header navigation between drafts).
