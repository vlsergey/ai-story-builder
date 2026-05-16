# fiction-arc V1: decouple narrative scenes from technical chunks

*Plan drafted 2026-05-16. Status: ready to execute.*

## Decision recap

- Current fiction-arc fuses `partsCount` = chunks = scenes (forced 1:1 mapping).
- This loses long-scene support (one scene needing >1500 words doesn't fit one chunk) AND short-scene packing (multiple short scenes wasted on one chunk each).
- New model:
  - **`chunksCount`** is the user-set output budget (ex-`partsCount`). Purely technical: how many ~1500-word LLM calls produce the final prose.
  - **Number of scenes** is LLM-chosen from synopsis + genre.
  - **Allocation** layer maps scenes → chunks.

## Allowed chunk modes (and the one forbidden one)

A chunk is one of:
1. **One scene fragment** (M:1 long-scene): `[{scene_id, portion: "first"|"middle"|"last"}]`. Exactly one fragment. The scene occupies ≥ 2 consecutive chunks fully.
2. **One full scene** (1:1): `[{scene_id, portion: "full"}]`.
3. **Packed full scenes** (1:M): `[{scene_id_a, "full"}, {scene_id_b, "full"}, …]`. Two or more, every one `"full"`.

**Forbidden:** a chunk that mixes a fragment with anything else (last bit of scene K + scene K+1 in same chunk). Scene boundaries always coincide with chunk boundaries.

## Node graph: before → after

Current fiction-arc has 37 plan nodes. The early phase (synopsis, world, theme, genre, setting, style, anketa, persona loop, persona summary) is **unchanged** — nodes 1–15.

Changes from node 16 onward:

| # | Before | After (V1) | Notes |
|---|---|---|---|
| 16 | «План сюжета» (text) | **«План сцен»** (text) | New prompt: LLM picks N scenes; each scene has title, G/C/D, emotional shift, `chunk_count ≥ 1`. **Σ chunk_count over long scenes + count of packed-chunks for short scenes = chunksCount.** Output format: numbered scene list with explicit per-scene chunk allocation. |
| 17 | «Реестр сетапов и пэйоффов» | same title | Prompt adapted to reference scene-ids from «План сцен» (already scene-level conceptually; minor wording fix). |
| 18 | «Ревью плана сюжета» | **«Ревью плана сцен»** | Find-step adapted: section-14 rules at SCENE granularity (Disaster=event, beat-type variety, on-stage chars, material follow-up, deadline pressure), plus new check **«сумма chunk_count ≠ chunksCount»** severity 95 (mathematical invariant). For V1 keep single fix-problems node; segregation into structural+polish passes deferred to V2. |
| 19 | «Разбиение плана сюжета» (split) | **«Распределение по чанкам»** (split) | New prompt: takes scene list, emits **exactly `chunksCount` chunk-description blocks**. Each block declares mode (fragment / full-one / packed-multi) and scene metadata. `partDescription` describes the chunk-block format. |
| 20 | «Цикл сцен — первый драфт» (for-each) | **«Цикл по чанкам»** (for-each) | Iterates `chunksCount` times. |
| 21 | «Бит» (for-each-input) | **«Чанк»** | Carries chunk-block text (mode + scene metadata). |
| 22 | «Номер сцены» (for-each-index) | **«Номер чанка»** | Renumbered. |
| 23 | «Предыдущие сцены» (for-each-prev-outputs) | **«Предыдущие чанки»** | All prior chunks, regardless of scene. |
| 24 | «Сборка предыдущих сцен» (merge) | **«Сборка предыдущих чанков»** | Merge of prior chunks. |
| 25 | «План сцены» (text) | **«План чанка»** (text) | Mode-aware: for a fragment-chunk, expands the fragment's role (start/middle/end of scene); for full-scene-chunk, full Свейн plan; for packed-chunks, plan for each sub-scene with marker between. |
| 26 | «Режиссёрские пометки» | **«Режиссёрские пометки чанка»** | Same idea, chunk-scope. |
| 27 | «Проза сцены» | **«Проза чанка»** | Mode-aware prose generation. ~1500 words. Mode metadata read from chunk input. |
| 28 | «Полировка прозы (драфт 1)» | **«Полировка прозы чанка»** | Polish per chunk. |
| 29 | «Выход первого драфта» (for-each-output) | **«Выход чанка»** | Output of one chunk's prose. |
| 30 | «Сборка первого драфта» (merge) | **«Сборка драфта»** | Final concat. |
| 31–37 | Second-draft loop + «Сборка финала» | **DELETED** | Deferred to V2. V1 ends after «Сборка драфта». |

## Detailed prompt sketches

### «План сцен» (node 16) — replaces «План сюжета»

```text
## Возрастной рейтинг
${ageRatingLabel}. <scene list within rating>.

## Inputs
{{Синопсис}}, {{Тема}}, {{Сводка по персонажам}}, {{Сеттинг}}, {{Мир}}, {{Жанр и регистр}}.

## Task

Составь план сцен повести. Количество сцен ВЫБИРАЕШЬ ТЫ исходя из синопсиса и
жанра — где-то 4-20 сцен на короткую/среднюю повесть. Каждая сцена — независимый
драматический атом с G/C/D и сменой эмоционального заряда.

Для каждой сцены укажи:
- Заголовок (одно предложение, ~5–10 слов).
- G/C/D прозой.
- Эмоциональный сдвиг прозой.
- `chunk_count`: целое число технических чанков, которые сцена займёт.
  - 1 для коротких сцен (≤ ~1500 слов).
  - 2+ для длинных (более ~1500 слов прозы).
  - Если в одном чанке должно поместиться несколько коротких сцен — каждая
    из этих сцен имеет `chunk_count: 1` (это не противоречит — packing
    решается на следующем шаге, в распределении).

## Жёсткие правила

1. Σ `chunk_count` по всем сценам ≥ chunksCount (если меньше — части прозы
   некуда деться). Допускается ≤ chunksCount, если планируется packing
   коротких сцен.
2. Если в плане сценочей > chunksCount — distribute явно отметит сцены под
   packing. Это OK, шаблон поддерживает.
3. Применяются правила 14.1–14.6 TEMPLATE_CHECKS: Disaster=event,
   scene-type variety, final scene with concrete gesture, material
   follow-up, on-stage characters get profiles, deadline pressure.

## Output format

Numbered list. На русском.
```

### «Распределение по чанкам» (node 19) — replaces «Разбиение плана сюжета»

```text
## Inputs
{{План сцен}} — scene list with per-scene `chunk_count`.
chunksCount = ${chunksCount}.

## Task

Распредели сцены по ровно ${chunksCount} техническим чанкам прозы. Каждый
чанк — один из трёх режимов:

- **fragment**: одна сцена, часть (start/middle/end). Сцена занимает ≥ 2
  чанка подряд, и этот чанк — один из них.
- **full**: одна сцена целиком в этом чанке.
- **packed**: ≥ 2 коротких сцены целиком в этом чанке.

Запрещено: смешать fragment с чем-то ещё. Если в чанке есть fragment —
он там единственный.

## Output

Массив из ровно ${chunksCount} строк. Каждая строка — JSON-объект на
одной строке:

`{"mode": "fragment"|"full"|"packed", "scenes": [{"scene_id": N, "title":
"...", "portion": "first"|"middle"|"last"|"full", "word_budget": INT,
"gcd": "..."}, …]}`

partDescription: описание одного чанка в формате JSON-одной-строкой с
полями mode и scenes (см. выше).
```

### «Проза чанка» (node 27)

```text
## Inputs
{{Чанк}} — JSON с metadata (mode, scenes).
{{Сборка предыдущих чанков}}, {{Стиль}}, {{Сводка по персонажам}},
{{Сеттинг}}, {{Режиссёрские пометки чанка}}, {{План чанка}}.

## Task (mode-aware)

Распарсь metadata. По режиму:

- **fragment** (portion=first): начни сцену. Заверши на полу-движении,
  не закрывая G/C/D — это сделает последний чанк сцены.
- **fragment** (portion=middle): продолжи с того места, где закончил
  предыдущий чанк ЭТОЙ сцены (см. «Сборка предыдущих чанков»). Не
  начинай сцену заново и не закрывай её.
- **fragment** (portion=last): закрой сцену катастрофой по Свейну.
  Открытия не повторяй.
- **full**: цельная сцена, обычная G/C/D + смена заряда.
- **packed**: пиши все сцены подряд, каждая с `## Сцена N` заголовком и
  собственной G/C/D. Между сценами — пустая строка и заголовок следующей.

Header: `## Часть {{Номер чанка}}` первой строкой ВСЕГДА (для сборки).

~1500 слов на чанк (или сумма word_budget'ов если packed). Все остальные
правила как сейчас.
```

## Implementation phases

Each phase ends with `npm run precommit` + commit + push. If something
breaks, revert that phase rather than tangle.

1. **Wizard rename.** `partsCount` → `chunksCount` (field name + all
   `${partsCount}` substitutions + `${round(1000/partsCount)}` formulas
   updated or removed). Description rewritten to drop scenes-equals-chunks
   framing.
2. **«План сюжета» → «План сцен».** New prompt (scene list with per-scene
   chunk_count).
3. **«Реестр сетапов и пэйоффов».** Minor adaptation to reference scenes
   explicitly.
4. **«Ревью плана сюжета» → «Ревью плана сцен».** Find-step adapted; add
   Σ-chunk_count = chunksCount invariant check.
5. **«Разбиение плана сюжета» → «Распределение по чанкам».** New split
   prompt + partDescription. JSON-per-chunk format.
6. **Loop refactor.** Rename nodes inside «Цикл сцен — первый драфт»
   to chunk-aware. Update each child node's prompt for chunk-mode logic.
7. **Delete second-draft loop and final merge.** Nodes 31–37. The merge
   from node 30 becomes the final output.
8. **Layout refresh** (`npm run layout-templates`).
9. **Structural tests pass.** `npm run test`.
10. **Manual smoke**: load Письмо.sqlite (it'll be on the OLD schema —
    user re-applies template via Update-from-template, then regenerates).

## Risks

- **Σ chunk_count invariant**: the model may not honor «сумма = chunksCount»
  precisely. Mitigation: explicit hard rule in plan prompt + severity-95
  check in plan review.
- **Allocation mode confusion**: the LLM may produce invalid chunk blocks
  (mixed mode). Mitigation: explicit hard rules in distribute prompt +
  finder check in plan review (could even be a structural autotest in
  templates-structure.test.ts on the chunk allocation output JSON).
- **Mode-aware prose prompt complexity**: «Проза чанка» has 5 branches
  (3 fragment portions + full + packed). Model might confuse modes. For
  V1, accept some failure; instrument with «Полировка чанка» catching
  mode-mismatch errors.
- **Continuity within fragment-spanned scene**: «Сборка предыдущих
  чанков» merges ALL prior chunks. For fragment-mode chunks, the prose
  prompt needs to find «previous chunks of THIS scene» — implementation
  is filtering by scene_id from the assembled prior chunks. For V1, can
  let the LLM do this scoping based on chunk metadata in inputs.

## Out-of-scope for V1 (deferred to V2+)

- Second-draft rewrite loop (the «Цикл сцен — второй драфт»). V2 will
  decide whether second-draft operates on full scenes or chunks.
- Polish at scene level (currently polish is per-chunk). V2 could add
  a scene-level polish pass after all chunks of a scene complete.
- Setup/payoff verification across chunks. V2.
- Update fiction-arc's description / label to mention the new
  architecture explicitly.

## Verification plan

After V1 lands:

1. Apply fiction-arc to a fresh project with synopsis = «Письмо», chunksCount
   = 5.
2. Run regeneration end-to-end.
3. Check «План сцен» — LLM should pick 3-5 scenes for a 5-chunk budget.
4. Check «Распределение по чанкам» — chunks should be a mix of full and
   maybe one fragment-pair (e.g., scene 2 spans chunks 2-3).
5. Read «Сборка драфта» — should be a coherent ~7500-word draft with
   proper scene boundaries and continuity.

If LLM picks fewer scenes than expected (e.g., 1 scene over 5 chunks),
the template's hard rules might need tightening. If LLM packs all scenes
into 1 chunk, the rules need a lower bound on `chunk_count` or
distribution constraint.

## Estimated effort

5-7 hours of focused refactor + test cycles. Possible to compress with a
clean context window and the plan above as the brief.
