# Project → updated-template reconciler

Date: 2026-05-14
Status: design + initial implementation

## Goal

Pick up changes from the on-disk template file into an existing project, while
preserving the user's generated and manually-edited content. Triggered by user
from a menu, with a preview dialog that counts the affected nodes/edges.

## Constraints (per discussion)

1. No version field, no JSON snapshot. The project IS the materialised
   template; compare its stored instruction fields to the fresh template on
   demand.
2. Re-apply only instruction-shaped fields (`userPrompt`, `systemPrompt`,
   `aiUserInstructionsToFindProblems`, `aiUserInstructionsToFixProblems`, and
   the matching system variants) and the `nodeTypeSettings` body for non-LLM
   types (e.g. fix-problems' `maxIterations`, `minSeverityToFix`,
   `foundProblemsTemplate`, `sourceNodeIdToFix`).
3. Never touch `content`, `summary`, `status`, counts. Don't compare them.
4. For template nodes whose `content` array contains a wizard placeholder
   (`${var}`), skip them entirely on the content side — those are
   user-personalised values.
5. Don't delete anything in the project that the template doesn't have. No
   warning either — just leave it alone.
6. Add nodes and edges that exist in the template and don't exist in the
   project.

## Data needed in project settings

Already present:
- `appliedTemplateFile` — basename of the source template file.

New:
- `appliedTemplateWizardData: Record<string, string>` — the wizard answers
  used at apply time. Required to re-substitute `${var}` placeholders in the
  fresh template prompts before comparing them with the project's stored
  (post-substitution) versions. Without this, every template node that had a
  `${var}` in a prompt would always show as "changed".

Both populated in `createProject → importProjectFromTemplate`.

## Algorithm

### `analyzeTemplateUpdate(): TemplateUpdateAnalysis`

1. Read `appliedTemplateFile` + `appliedTemplateWizardData` from settings.
   If either missing → error "project was not created from a template".
2. Load fresh template JSON from the standard templates directory.
3. Walk template plan nodes, build map `byTitle: Map<string, TemplateNode>`.
4. Walk project plan nodes, build map `projectByTitle: Map<string, PlanNodeRow>`.
5. For each template node:
   - If not in project → add to `newNodes` (title + type).
   - If in project → compute `normalisedTemplateInstructions(node, wizardData)`,
     compare with project's stored instructions:
     - For `text` / `split` / `lore`: compare `node_type_settings` JSON
       fields `userPrompt` and `systemPrompt`.
     - For `fix-problems`: compare `aiUserInstructionsToFindProblems`,
       `aiUserInstructionsToFixProblems`, the system variants, plus
       `maxIterations`, `minSeverityToFix`, `foundProblemsTemplate`. Skip
       `sourceNodeIdToFix` (translated at apply time; if its title changed
       in template that's a structural change handled by edges).
     - For `for-each*`, `merge`, `for-each-output/input/index/prev-outputs`:
       compare `node_type_settings` JSON as a whole.
   - If different → `updatedNodes.push({ title, type })`.
   - If same → `unchangedNodes += 1`.
6. Project-only nodes (not in template) — not collected, not displayed.
7. Edges: build sets of `(sourceTitle, targetTitle, type)` for both. Any
   template-side triple absent in project goes into `newEdges`.

Returns:
```ts
interface TemplateUpdateAnalysis {
  templateFile: string
  unchangedCount: number
  updatedNodes: Array<{ title: string; type: string }>
  newNodes: Array<{ title: string; type: string }>
  newEdges: Array<{ sourceTitle: string; targetTitle: string; type: string }>
}
```

### `applyTemplateUpdate(): { appliedAt: string }`

Mutates project DB:
1. For each `updatedNode`: rewrite `node_type_settings` to the freshly
   normalised version; set `status = "OUTDATED"`.
2. For each `newNode`: insert via `PlanNodeRepository`; set initial settings
   from template; status `EMPTY`.
3. For each `newEdge`: insert via `PlanEdgeRepository`. Source/target IDs
   resolved by title in the current project.
4. Emit plan-node/plan-edge update events so the UI refreshes.

Returns timestamp.

### Wizard substitution mismatch (the trap)

Project stored prompts are post-substitution (user's synopsis is inlined).
Fresh template prompts are pre-substitution (`${synopsis}` literal). So the
comparison MUST apply the same substitution to the template side using
`appliedTemplateWizardData`. The substitution helper already exists
(`normalizeAndReplaceContent` in `apply-project-template.ts`).

If a wizard variable's name changed in the template and the project's
`appliedTemplateWizardData` doesn't have it, the substituted prompt will
contain an empty string for that var. That counts as "changed" — fair.

## UI

Menu item "Update from template" (project-level, only enabled when
`appliedTemplateFile` is set). On click:

1. Call `analyzeTemplateUpdate`. If "no template" — show "this project was
   not created from a template" toast.
2. Show dialog:
   ```
   Шаблон fiction-arc.ru обновился. Применить изменения к проекту?

     N узлов останутся без изменений
     M узлов получат обновлённые инструкции (статус → OUTDATED) ▾
        — list of titles, expandable
     K узлов будет добавлено ▾
        — list
     E связей будет добавлено ▾
        — list

   Содержимое сгенерированных и редактированных вручную узлов не затрагивается.
   Узлы и связи, существующие только в проекте, не удаляются.

   [Отмена]  [Применить]
   ```
3. On "Применить" → call `applyTemplateUpdate`, dismiss dialog.

If all three counts (updated/new-nodes/new-edges) are zero — show a benign
"шаблон не менялся" instead of the apply dialog.

## What this design intentionally does NOT do

- Detect node renames. A renamed template title looks like one node deleted
  (project-only, ignored) and one added (new). User can resolve manually.
- Detect rewired edges (existing edge's target changed). Same reason.
- Show before/after diff of changed instructions. Counts + titles only.
- Backfill nodes that exist in template but were intentionally removed by
  the user from the project. There's no flag to mark "I deleted this on
  purpose", so add-on-update is the safer default. Users can re-delete.

## Implementation order

1. Setting + persist `appliedTemplateWizardData` in createProject.
2. `src/backend/projects/template-update.ts` with `analyze` + `apply`.
3. tRPC routes (analyze query, apply mutation).
4. UI: menu item + dialog component.
5. Tests: analyzer-only on fiction-arc fixture (no DB write); apply happy
   path against a fixture project DB.
