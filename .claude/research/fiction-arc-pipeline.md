# Fiction arc generation pipeline — design notes

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

A design for a template that takes a single synopsis from the user and produces a ~30k-character, 20-part fiction arc (≈ 250 words / 1500 chars per part). Compiled from a multi-step discussion about craft technique (Snowflake, Save the Cat, Story/McKee, scene-sequel/Swain, Truby) translated into the graph-of-LLM-calls model the project uses.

## Sizing math

- Total ≈ 30 000 chars / 20 parts = **1500 chars (~250 words) per part**.
- Comfortable inside Grok's ~1500-word output cap.
- Per-scene input context: ~13–15k tokens (all prior scenes in full + plot outline + cast + style + scene plan + director notes). Comfortable inside 128k context. **Cost is not a binding constraint for this project** — see [[project-grok-output-cap]].

## Cost-relaxed assumptions

These are explicit choices made when the user said tokens are cheap:

- No `Logline` as token-saver — full synopsis flows downstream.
- `for-each-prev-outputs` passes **all** previous scenes in full, not a running summary. Wired via a thin `merge` with `## Сцена N` separators so order is preserved.
- Second-draft pass is a separate `for-each` over the same 20 beats with the entire first draft visible. The cost is ×2 LLM calls on prose; the quality jump is the point of the whole pipeline.

## Block layout

### Preparation block (parallel branches from Synopsis)

- `Synopsis` — text node, content from wizard.
- `Theme / controlling idea` — text. McKee's controlling idea.
- `Genre & register` — text.
- `Setting / world` — text.
- `Characters (initial list)` → `llm-split` (per character) → for-each(`Character profile` + `Character review` via fix-problems) → `Cast bible` (merge). Per-character LLM passes are the **single highest-impact addition** for quality — flat characters are the most common LLM-fiction failure.
- `Style guide` — text. Depends on Theme + Genre. POV, tense, rhythm, vocabulary, taboos.

### Plot block

- `Plot outline` — text. Free prose, 20 beats. Inputs: Synopsis, Theme, Cast bible, Setting, Genre. Loosely follows Save the Cat 15 beats stretched to 20 with breathing scenes.
- `Setup/Payoff registry` — text. New node, lists what is planted in which beat and where it pays off. Inputs: Plot outline, Cast bible.
- `Plot outline review` — fix-problems over Plot outline. Sees registry + Cast bible. Catches orphan setups, motivation gaps, broken character arcs.
- `Plot outline → JSON array` — `text` node with `responseSchema` whose only job is to convert the prose outline into a clean `string[]`. **Always wired as a separate stage from the creative generation** because schema-constrained calls go into compliance mode — see [[project-json-schema-dumbs-models]].
- `llm-split` (after refactor — this is the new LLM-driven split) → `textArray[20]`. Note: this **replaces the reformat-to-JSON step** above; the new `llm-split` does the reformat-and-parse internally.

### Scene block (first-draft for-each)

For each beat:
- `Scene plan` — text. Inputs: current beat, full Plot outline, registry, Cast bible, Setting. Goal/Conflict/Disaster per Swain. Emotional charge per McKee.
- `Director notes` — text. Subtext, sensory anchors, opening/closing line, key image. Critical at the 250-word scale.
- `Scene prose` — text. Inputs: Scene plan, Director notes, Style guide, Cast bible, Setting, **`for-each-prev-outputs` (full prose of all earlier scenes)**. Prompt instruction must say "for continuity, not verbatim style copying" or the model dives into copypasta.
- `Scene polish` — fix-problems. Inputs: Scene prose, Style, Cast bible, prev-outputs (catches sequence-wide repetition).

### Second-draft block

- `Merge first draft` — joins 20 first-draft scenes.
- `Second-draft for-each` over the same 20 beats. Each iteration gets the entire first draft + original Scene plan + Style + Cast bible. Produces a rewritten scene with full-arc awareness — foreshadowing tightens, motifs echo. **This is where the pipeline stops sounding like a chatbot.**
- `Second polish` per scene.

### Final block

- `Merge final` — joins polished 20 scenes with `## Часть N` headers.
- Optional triple find-only review: Theme adherence, Continuity (names/props/descriptions), Voice & pacing. All three operate on the merged final draft and produce lists of issues for the user — no automated rewrite (output cap can't repack 30k chars).

## Where corrections live

Five places, in order of leverage:

1. **Plot outline review** (single, before scenes) — cheapest, biggest payoff.
2. **Per-character review** (×N) inside Cast bible for-each.
3. **First-draft per-scene polish** (×20).
4. **Second-draft per-scene polish** (×20).
5. **Triple global review** (find-only) on final merge.

## Engine pre-requisites

This pipeline assumes the `llm-split` refactor is done (commit `fbdbe20`). It does NOT depend on any of the deferred primitives in [`graph-primitives-gaps.md`](graph-primitives-gaps.md).
