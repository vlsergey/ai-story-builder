# Template authoring checks (LLM-judgement only)

Quality bar for project templates that **requires reading the prose** and can't be reduced to a regex or a structural walk. When auditing a template (existing or new), walk this list and flag every node that fails.

Mechanical / structural rules (every `{{X}}` resolves, every `fix-problems` has both prompt arrays, titles are globally unique, every `${var}` has a wizard field, etc.) are NOT in this file — they live in [`templates-structure.test.ts`](./templates-structure.test.ts) and run on every commit. If a test there fails, fix the template; don't move the rule here.

This file is the canonical checklist for the parts that genuinely need an LLM to read the prompts and judge intent. If a real-world failure surfaces a missing rule, add it here first — and consider whether it could be automated.

---

## 1. Template description

1.1. The top-level `description` field is **outcome-oriented**: it tells the user what they'll get and when to reach for this template. Not what the template's internals look like.

1.2. Good signal: "You get a ~30 000-word novella from one short synopsis. Reach for it when…". Bad signal: "The template contains a node A, then node B, then a for-each over beats, then a merge…".

1.3. The description includes at minimum: the form of the output ("novella in prose", "novel in chapters", "set of marketing headlines"), the rough scale ("~30 000 words", "5 headlines of 10 words each"), and the use cases / scenarios the template fits.

---

## 2. Output sizing

2.1. Every LLM-calling text-generating node states an explicit output size target in its `aiUserInstructions` ("100–150 words", "200–400 words", "target ~1500 words" — in the language of the template). No node leaves the model free to pick output length.

2.2. The target is framed as a **soft goal**, not a hard floor. Phrasing like "target ~1500 words, shorter is fine if it's dense" is correct; phrasing like "exactly 1500 words, otherwise regenerate" is wrong for prose. Hard counts are reserved for *structural* lists (item 6).

2.3. **Upper bounds below the model's output cap need a reason.** When a node's purpose can scale with content (a profile, a world description, a setting, a scene plan), prefer "up to ~1500 words, write what's needed, don't pad" over an arbitrary tight cap like "200–400 words". Tight caps are reserved for nodes whose output is naturally short by construction (a one-line classification, a fixed-length list).

2.4. No single node's target exceeds the model's per-call output cap (~1500 words for Grok). If the target is above ~1400 words, the node should be split into smaller pieces or the target lowered.

2.5. **Anywhere a word count appears in the prompt** (target, range, or ceiling), explicitly forbid emitting the count in the output: a sentence like "do not include the word count in the output" (in the template's language). Without this guard, the model treats the number as something to report back and emits "(123 words)" annotations into the result.

---

## 3. Prompt ordering for cache friendliness

The LLM's prompt cache keys on the longest matching **prefix** of the user message. Cross-call cache hits maximize when static content sits at the top and dynamic content at the bottom.

3.1. Within each prompt, sections referencing static-across-iterations inputs come **before** sections referencing dynamic-per-iteration inputs.

   - Static-across-iterations (for a node inside a for-each): cross-parent inputs (style guide, cast bible, setting, plot outline, setup/payoff registry) — they don't change while iterating.
   - Dynamic-per-iteration: sibling inputs from the same for-each (current beat, scene plan, director notes, the prev-outputs merge, the iteration index) — they all change with the iteration.

3.2. Within each prompt, the task block (the instruction itself — static text, typically introduced by a "what to do" h2 heading) sits AFTER all input sections. Placing it dead-last means the cache benefit on the prefix is captured by everything above it.

3.3. For nodes NOT inside a for-each (project-once nodes), this rule still applies as a guideline against later edits: inputs that the author is more likely to tweak (like style guide) go below inputs that are more likely to stay frozen (like the original synopsis).

---

## 4. Delimitation of substituted content

4.1. Every `{{X}}` placeholder bringing in **multi-line** content is visually delimited from surrounding instructions. Two acceptable mechanisms (pick one per placeholder, don't mix on the same one):

   - Triple-backtick fence around the placeholder:
     ```
     \`\`\`
     {{X}}
     \`\`\`
     ```
   - Heading-bracketed section: a `##` heading before, the placeholder on its own paragraph, then a different `##` heading after.

4.2. **Single-token / inline** placeholders are bare. For example, an inline reference like `find the section `## Part {{SceneNumber}}`` keeps `{{SceneNumber}}` inline because the surrounding text is the delimiter.

4.3. Inside a fenced block, the placeholder is on its own line — never `\`\`\`{{X}}\`\`\`` on one line, because the model often parses that as code, not a substitution.

---

## 5. Wizard field copy

5.1. Wizard field `description` is one helpful sentence that tells the user what concretely to write — not the field type or repeating the label.

5.2. Wizard field `placeholder` is a **concrete example** that fits the field's purpose, not a meta description like "Enter text here".

(Existence and non-emptiness of `label`/`description`/`placeholder` are checked by the structural test — judge here only whether the copy is helpful.)

---

## 6. Structured-list generation safeguards

For text nodes whose output is a fixed-count structured list (e.g. "exactly 20 beats"), all of the following must appear in the prompt:

6.1. **Exact count** — "exactly N items" stated unambiguously.

6.2. **Length range per item** — "X to Y words per item" (with the upper bound chosen so that count × upper ≤ ~1400 words to stay under the output cap).

6.3. **Uniformity** — "all items equally detailed".

6.4. **Tail-not-shorter rule** — "the last items must NOT be shorter than the first". Without this, the model thins the tail.

6.5. **Auto-rewrite-if-short** — "if any item is shorter than the lower bound, automatically rewrite it".

6.6. **No-meta-word-count** — "do not include word count in the output". Otherwise the model emits "(50 words)" annotations into output.

---

## 7. Header / structural preservation across nodes

For pipelines where downstream nodes navigate by header (e.g. "find `## Part {{Index}}`"):

7.1. The header-producing node's prompt **explicitly** instructs: first line is `## Part {{Index}}`, exact format, no variation.

7.2. Polish / review / fix-problems nodes downstream of the header-producing node **explicitly** instruct: do not remove, modify, or shift the level of the header.

7.3. Merge nodes between them are configured `fixHeaders: false`, `includeNodeTitle: false`, `includeInputTitles: false` (so they don't reshape the embedded headers).

---

## 8. Continuity-without-mimicry instructions

For text nodes that receive prev-outputs (full prior scenes), the prompt must explicitly state:

8.1. The prior scenes are for **meaning / continuity**, **not** for copying stylistics or fragments verbatim. Without this, the model produces echo-prose by lifting phrasings.

8.2. The prompt also names what the prev-outputs are for in practical terms: "to avoid contradicting what was already written, to avoid repeating metaphors, to keep names straight".

---

## 9. Language consistency

9.1. For locale-specific templates (e.g. `*.ru.json`), all prompts, descriptions, labels, and placeholders are in that language. No accidental fragments of another language inside prompt prose. Placeholders that happen to be node titles in another language are allowed since they reflect node identity; foreign-language prose inside instruction text is not.

9.2. Register is consistent — e.g. either consistently informal or consistently neutral. Current convention for Russian templates: imperative neutral, no pronoun.

9.3. No `if`-style branches in instruction text (in any language — "if X then A, otherwise B" patterns confuse the model). Rewrite imperatively: state the desired action for each case as a separate sentence ("Canonical characters — canonical voice. New characters — invent.") instead of "if X then A, if Y then B".

---

## 10. Output format constraints

10.1. When the LLM should produce a specific format (numbered list, h2 headers, JSON), the prompt **explicitly** states the format.

10.2. Forbidden patterns are stated when relevant: "no bullets", "no numbering", "no opening or closing remarks", "output ONLY the result, no wrapper text".

10.3. For fix-problems' `aiUserInstructionsToFixProblems`, the prompt explicitly says "output only the corrected text" (or analog) — otherwise the model wraps with "Here is the corrected version:" prefixes.

10.4. **Classification / analysis / planning nodes (anything whose job is to describe ABOUT the work rather than write the work) explicitly forbid story prose.** Without this, when the prompt includes a synopsis or scene plan, the model can slide into writing the story itself — especially when given high word ceilings or the word "prose" anywhere in the instruction. The forbidding sentence should name the slippage concretely — e.g. "this is classification, not the work itself: do not write prose, do not compose scenes, do not produce dialogue" (in the template's language). Applies to: theme, genre, world description, character profile, scene plan, director notes, plot outline, setup/payoff registry, fix-problems find-step.

---

## How to use this list

When auditing:
- Walk through every LLM-calling node of the template.
- For each rule, note pass / fail / N/A (e.g. rule 6 is N/A for nodes that don't generate structured lists).
- Report failures with file:node:rule and the minimal change to pass.
- Don't fix in the same pass as the audit — first write the findings, then fix them (so the audit can be reviewed before changes).

If you find yourself wishing for a rule that could be automated (a regex pattern, a structural property), add it to [`templates-structure.test.ts`](./templates-structure.test.ts) instead of here.
