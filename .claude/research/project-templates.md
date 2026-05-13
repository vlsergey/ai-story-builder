# Project templates: export and apply

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

## What templates are for

A project template is a reusable blueprint: a configured plan graph + optional lore folder skeleton + wizard pages that ask the user a few questions when instantiating. The wizard answers fill `${VARNAME}` placeholders inside prompts and content fields of the template.

Templates ship in two flavors:
- **System templates**: bundled with the app, in `src/backend/resources/templates/` (read-only from the user's perspective). See [`project-templates.ts`](../../src/backend/projects/project-templates.ts) for discovery logic.
- **User templates**: written by `exportProjectAsTemplate` to a user-chosen path; the app keeps a directory of recent template files for the start screen wizard.

## File format

JSON validated against [`src/schemas/project-template.json`](../../src/schemas/project-template.json). The corresponding TS type is auto-generated to [`src/shared/project-template.ts`](../../src/shared/project-template.ts):

```ts
ProjectTemplate {
  label: string
  description: string
  wizardPages?: WizardPage[]   // { id, title, description?, fields: WizardField[] }
  lore?: { nodes: TemplateProjectLoreNode[] }
  plan: { nodes: TemplateProjectPlanNode[] }
}

TemplateProjectPlanNode {
  id: number             // ← the IDs the user wants to replace with titles
  title: string
  type: PlanNodeType
  x?, y?, width?, height?: number
  aiUserInstructions?: string[]
  nodeTypeSettings?: Record<string, any>
  content?: string[]
  children?: TemplateProjectPlanNode[]
  inputs?: { sourceNodeId: number; type: PlanEdgeType }[]
                                  // ← references by id; targets of the refactor
}

TemplateProjectLoreNode {
  id: number             // ← also id-based, also a refactor target
  title: string
  content?: string[]
  children?: TemplateProjectLoreNode[]
}
```

## ID usage today (refactor surface area)

Every place where IDs appear in the template format:

| Field | File | Line | Notes |
|---|---|---|---|
| `TemplateProjectPlanNode.id` | [project-template.json](../../src/schemas/project-template.json) | 92 | Required. Used as self-identifier. |
| `TemplateProjectPlanNodeInput.sourceNodeId` | [project-template.json](../../src/schemas/project-template.json) | 114 | References another node by id. |
| `TemplateProjectLoreNode.id` | [project-template.json](../../src/schemas/project-template.json) | 73 | Required. Used as self-identifier. |

In TypeScript the same fields appear in [`src/shared/project-template.ts`](../../src/shared/project-template.ts) at lines 48-49 (lore), 59-60 (plan), and 73-75 (input).

`children` and `parent` are expressed by **structural nesting** in the JSON (children: [...]) — they do NOT rely on IDs. So the only id-based references in the template format are: `sourceNodeId` in `inputs`, and the self-identifier `id` on each node.

## Export: from running project to JSON

[`src/backend/projects/export-project-as-template.ts`](../../src/backend/projects/export-project-as-template.ts):

1. Loads all `plan_nodes` and `plan_edges` from the DB.
2. Builds a `nodeMap: Map<number, TemplateProjectPlanNode>` keyed by **DB id** — this is the id that ends up in the JSON.
3. Pass 1 ([lines 19-57](../../src/backend/projects/export-project-as-template.ts#L19-L57)): create exported node entries with `id: node.id`. AI prompt and `node_type_settings` are split into arrays / parsed.
4. Pass 2 ([lines 59-72](../../src/backend/projects/export-project-as-template.ts#L59-L72)): for each edge, push `{ sourceNodeId: edge.from_node_id, type: edge.type }` into the target's `inputs` array.
5. Pass 3 ([lines 74-80](../../src/backend/projects/export-project-as-template.ts#L74-L80)): attach children to parents via `parent_id`.
6. Roots (parent_id is null) form `plan.nodes`.
7. Lore export ([lines 99-127](../../src/backend/projects/export-project-as-template.ts#L99-L127)) — only **folder** lore nodes (those that have children) are exported; leaf lore content is intentionally dropped.

**`label`** = project title from `SettingsRepository`. **`description`** = "" (no UI for it yet at export time). **`wizardPages`** = []. The recently-added [`ExportProjectAsTemplateOptions`](../../src/shared/export-as-template-options.ts) carries `filePath` and `exportLoreStructure`.

## Apply: from JSON to a new project's DB

[`src/backend/projects/apply-project-template.ts`](../../src/backend/projects/apply-project-template.ts):

1. Build a fresh `nodeIdMap: Map<oldId, newDbId>` ([line 26](../../src/backend/projects/apply-project-template.ts#L26)).
2. `createPlanNodes` recursive walker ([lines 28-53](../../src/backend/projects/apply-project-template.ts#L28-L53)): insert each node into `plan_nodes` and record old→new mapping. Content and `aiUserInstructions` arrays are joined with `\n` and run through `normalizeAndReplaceContent` ([lines 10-14](../../src/backend/projects/apply-project-template.ts#L10-L14)) which expands `${VARNAME}` against wizard answers.
3. Flatten and walk inputs again ([lines 59-89](../../src/backend/projects/apply-project-template.ts#L59-L89)): for each node's `inputs`, translate `sourceNodeId` and the target id through `nodeIdMap`, then insert a `plan_edges` row.
4. Lore is created similarly with its own `loreIdMap` ([lines 91-115](../../src/backend/projects/apply-project-template.ts#L91-L115)).

The `nodeIdMap` is exactly the indirection that the title-based refactor would replace with a `nodeTitleMap`.

## Wizard variables

`${VARNAME}` placeholders are expanded only in `content` and `aiUserInstructions` fields ([apply-project-template.ts:42-43](../../src/backend/projects/apply-project-template.ts#L42-L43)) — they do NOT currently work in titles, `node_type_settings`, or anywhere else. If the refactor moves to title-based references, we need to decide whether titles can also contain `${...}` (probably yes, since wizard answers will often want to flow into titles).

## Uniqueness — current state vs. what the refactor needs

- `lore_nodes` has `UNIQUE (parent_id, title)` at the SQL level ([schema.sql:44](../../src/backend/db/schema.sql#L44)) — lore titles are already unique within a parent.
- `plan_nodes` has **no** uniqueness constraint on `title`. The runtime tolerates duplicate plan-node titles. But `{{Title}}` substitution in prompts assumes titles uniquely identify a node within the scope of the consumer's inputs — duplicates lead to ambiguous behavior already.

For the planned refactor "use titles instead of IDs in templates":
- Export-time validation: walk both trees and reject (or auto-rename) duplicates within the same parent scope. Globally unique is overkill; sibling-unique matches the existing lore constraint.
- Import-time validation: same check on the parsed template before touching the DB.
- For `inputs.sourceNodeId` (currently a single number), the title might need disambiguation by parent — e.g. a dotted path `"ParentTitle/ChildTitle"` — because two different `for-each` containers could both contain a `text` node titled "Generate" without conflict. Worth a design decision.

## Tests

- [`src/backend/projects/template-coordinates.test.ts`](../../src/backend/projects/template-coordinates.test.ts) — verifies the recently-added coordinate persistence (x/y/width/height) in templates.
- [`src/backend/projects/sanitize-project-name.test.ts`](../../src/backend/projects/sanitize-project-name.test.ts) — project name sanitization.
- [`src/backend/projects/recent-projects.test.ts`](../../src/backend/projects/recent-projects.test.ts) — recent projects list management.

No end-to-end test covers export → apply roundtrip; worth adding one as part of the refactor.
