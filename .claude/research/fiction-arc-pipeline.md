# Fiction arc generation pipeline — design notes

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

Shipped template: [`src/backend/resources/resources/templates/fiction-arc.ru.json`](../../src/backend/resources/resources/templates/fiction-arc.ru.json). Takes a single synopsis from the user and produces a ~30 000-word novella across 20 beats (~1500 words/beat target). Compiled from craft technique (Save the Cat, Story/McKee, scene-sequel/Swain, Truby) translated into the graph-of-LLM-calls model.

## Sizing math

- Total target ≈ 30 000 words / 20 parts = **~1500 words per part**. This is the upper end of Grok's output cap, used as a soft target — see [[project-grok-output-cap]]. If a scene comes in shorter but dense, we do not regenerate to pad it.
- Plot outline node: 20 beats × 50–70 words = max 1400 words. Comfortably inside the cap (single LLM call).
- Per-scene input context, late in the for-each: ~30k–40k words of prior scenes via the prev-outputs merge + outline + cast + style + scene plan. Fits inside 128k context with room.

## Cost-relaxed assumptions

These are explicit choices made when the user said cost is not a binding constraint:

- No `Logline` as token-saver — full synopsis flows downstream.
- `for-each-prev-outputs` passes **all** previous scenes in full via a sibling `merge`. No running summary.
- Second-draft pass is a separate `for-each` over the same 20 beats with the entire first draft visible (cross-parent edge from `Merge first draft` into the second for-each).

## Block layout (matches the bundled template)

### Preparation block

- `Синопсис` — text from wizard `${synopsis}` substitution.
- `Канон / источник` — text. Identifies fanfic vs original. For fanfic: emits `Фандом: …` + canon description. For original: a one-liner "Оригинальный мир — внешнего канона нет." Feeds Setting, Plot outline, Character profile.
- `Тема` — McKee's controlling idea.
- `Жанр и регистр` — text.
- `Сеттинг` — text. Reads Synopsis + Канон.
- `Стиль` — text. Reads Theme + Genre.
- `Персонажи (список)` → `Разбиение списка персонажей` (llm-split with `partDescription`) → `Цикл по персонажам` (for-each: `Профиль персонажа` + `Ревью персонажа` via fix-problems) → `Сводка по персонажам` (merge over for-each output textArray).

### Plot block

- `План сюжета` — text. Reads Synopsis, Theme, Cast bible, Setting, Канон, Genre. Save the Cat 15 beats stretched to 20. **Hard rules in the prompt** ("ровно 20", "50–70 слов на пункт", "последние не короче первых", "перепиши если меньше 50") — without them, the model truncates later items.
- `Реестр сетапов и пэйоффов` — text. Lists planted/payoff pairs across three axes: plot, emotional, thematic.
- `Ревью плана сюжета` — fix-problems over `План сюжета`. Sees registry + cast.
- `Разбиение плана сюжета` — llm-split with `partDescription` ("один бит 50–70 слов, без номера, со структурой G/C/D"). Output: textArray[20] feeding both for-eachs.

### Scene block (first-draft for-each, x20)

Inside `Цикл сцен — первый драфт`:

- `Бит` (for-each-input), `Номер сцены` (for-each-index), `Предыдущие сцены` (for-each-prev-outputs).
- `Сборка предыдущих сцен` — merge over prev-outputs textArray. Plain join, no titles.
- `План сцены` — text. Inputs: current beat, full `План сюжета`, registry, cast, setting (cross-parent).
- `Режиссёрские пометки` — text. Inputs: scene plan + style.
- `Проза сцены` — text. Inputs: plan + director notes + style + cast + setting + сборка предыдущих + номер сцены. Hard rule: first line must be `## Часть {{Номер сцены}}` for downstream navigation.
- `Полировка прозы (драфт 1)` — fix-problems. Source = `Проза сцены`. Preserves `## Часть N` header. Sees style + cast + prev outputs.
- `Выход первого драфта` (for-each-output) ← polish.

### Second-draft block

- `Сборка первого драфта` — merge over the first for-each output. Joins all 40 polished scenes (well, 20 — one per beat) preserving `## Часть N` headers.
- `Цикл сцен — второй драфт` — second for-each over the SAME beats textArray. Inside:
  - `Бит второго драфта` (for-each-input), `Номер сцены второго драфта` (for-each-index — separately titled to satisfy global uniqueness).
  - `Переписывание сцены` — text. Prompt: "find `## Часть {{Номер сцены второго драфта}}` in the full first draft, rewrite that section with full-arc awareness — foreshadowing, echoes, motif tightening. Don't change plot."
  - `Полировка прозы (драфт 2)` — fix-problems.
  - `Выход второго драфта` ← polish.

### Final

- `Сборка финала` — merge over the second for-each output. Concatenates with `\n\n` separator; `## Часть N` headers are already in scene content.
- Optional triple find-only review (Theme adherence, Continuity, Voice & pacing) — not in the bundled template; can be added later.

## Where corrections live

Five places, in order of leverage:

1. **Ревью плана сюжета** (single, before scenes) — cheapest, biggest payoff.
2. **Ревью персонажа** (×N) inside cast for-each.
3. **Полировка прозы (драфт 1)** (×20).
4. **Полировка прозы (драфт 2)** (×20).
5. (Optional) **Triple global review** (find-only) on final merge.

## Engine pre-requisites — all shipped

- `llm-split` (commit `fbdbe20`).
- Prompts in node_type_settings (commit `a9aaed8`).
- `partDescription` on split (commit `94794eb`).
- Cross-parent edge resolution in templates (commit `7ba71c8`).
- `for-each-index` node type (commit `4de6157`).
- Bundled template + test (commit TBD — adds `fiction-arc.ru.json` and its load/apply test).

## Practical lessons from the prompt

These came up while writing the template prompts and are non-obvious:

- **Length-uniformity rules in the plan prompt** are mandatory. Without explicit "ровно 20 пунктов / 50–70 слов / последние не короче / перепиши если короче" the model thins the tail of the plan.
- **`## Часть N` as first-line header on every scene** is the navigation primitive for the second pass. The polish node prompt must explicitly forbid removing/modifying this header.
- **Канон / источник as a separate top-level node** so fanfic synopses (e.g. "Гарри и Драко находят…") get a deliberate canon-anchoring step instead of the LLM guessing or improvising.
- **Multi-line `{{X}}` substitutions get fenced or heading-bracketed** in all prompts (see memory `feedback_template_prompt_style`). Inline single-token references like `{{Номер сцены}}` stay bare.
