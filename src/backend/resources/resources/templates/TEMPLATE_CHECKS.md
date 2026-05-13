# Template authoring checks (LLM-judgement only)

Quality bar for project templates that **requires reading the prose** and can't be reduced to a regex or a structural walk. When auditing a template (existing or new), walk this list and flag every node that fails.

Mechanical / structural rules (every `{{X}}` resolves, every `fix-problems` has both prompt arrays, titles are globally unique, every `${var}` has a wizard field, etc.) are NOT in this file — they live in [`templates-structure.test.ts`](./templates-structure.test.ts) and run on every commit. If a test there fails, fix the template; don't move the rule here.

This file is the canonical checklist for the parts that genuinely need an LLM to read the prompts and judge intent. If a real-world failure surfaces a missing rule, add it here first — and consider whether it could be automated.

---

## 1. Output sizing

1.1. Every LLM-calling text-generating node states an explicit output size target in its `aiUserInstructions` ("100–150 words", "200–400 words", "target ~1500 words" — in the language of the template). No node leaves the model free to pick output length.

1.2. The target is framed as a **soft goal**, not a hard floor. Phrasing like "target ~1500 words, shorter is fine if it's dense" is correct; phrasing like "exactly 1500 words, otherwise regenerate" is wrong for prose. Hard counts are reserved for *structural* lists (item 7).

1.3. No single node's target exceeds the model's per-call output cap (~1500 words for Grok). If the target is above ~1400 words, the node should be split into smaller pieces or the target lowered.

---

## 2. Prompt ordering for cache friendliness

The LLM's prompt cache keys on the longest matching **prefix** of the user message. Cross-call cache hits maximize when static content sits at the top and dynamic content at the bottom.

2.1. Within each prompt, sections referencing static-across-iterations inputs come **before** sections referencing dynamic-per-iteration inputs.

   - Static-across-iterations (for a node inside a for-each): cross-parent inputs (style guide, cast bible, setting, plot outline, setup/payoff registry) — they don't change while iterating.
   - Dynamic-per-iteration: sibling inputs from the same for-each (current beat, scene plan, director notes, the prev-outputs merge, the iteration index) — they all change with the iteration.

2.2. Within each prompt, the task block (the instruction itself — static text, typically introduced by a "what to do" h2 heading) sits AFTER all input sections. Placing it dead-last means the cache benefit on the prefix is captured by everything above it.

2.3. For nodes NOT inside a for-each (project-once nodes), this rule still applies as a guideline against later edits: inputs that the author is more likely to tweak (like style guide) go below inputs that are more likely to stay frozen (like the original synopsis).

---

## 3. Delimitation of substituted content

3.1. Every `{{X}}` placeholder bringing in **multi-line** content is visually delimited from surrounding instructions. Two acceptable mechanisms (pick one per placeholder, don't mix on the same one):

   - Triple-backtick fence around the placeholder:
     ```
     \`\`\`
     {{X}}
     \`\`\`
     ```
   - Heading-bracketed section: a `##` heading before, the placeholder on its own paragraph, then a different `##` heading after.

3.2. **Single-token / inline** placeholders are bare. For example, an inline reference like `find the section `## Part {{SceneNumber}}`` keeps `{{SceneNumber}}` inline because the surrounding text is the delimiter.

3.3. Inside a fenced block, the placeholder is on its own line — never `\`\`\`{{X}}\`\`\`` on one line, because the model often parses that as code, not a substitution.

---

## 4. Wizard field copy

4.1. Wizard field `description` is one helpful sentence that tells the user what concretely to write — not the field type or repeating the label.

4.2. Wizard field `placeholder` is a **concrete example** that fits the field's purpose, not a meta description like "Enter text here".

(Existence and non-emptiness of `label`/`description`/`placeholder` are checked by the structural test — judge here only whether the copy is helpful.)

---

## 5. Structured-list generation safeguards

For text nodes whose output is a fixed-count structured list (e.g. "exactly 20 beats"), all of the following must appear in the prompt:

5.1. **Exact count** — "exactly N items" stated unambiguously.

5.2. **Length range per item** — "X to Y words per item" (with the upper bound chosen so that count × upper ≤ ~1400 words to stay under the output cap).

5.3. **Uniformity** — "all items equally detailed".

5.4. **Tail-not-shorter rule** — "the last items must NOT be shorter than the first". Without this, the model thins the tail.

5.5. **Auto-rewrite-if-short** — "if any item is shorter than the lower bound, automatically rewrite it".

5.6. **No-meta-word-count** — "do not include word count in the output". Otherwise the model emits "(50 words)" annotations into output.

---

## 6. Header / structural preservation across nodes

For pipelines where downstream nodes navigate by header (e.g. "find `## Part {{Index}}`"):

6.1. The header-producing node's prompt **explicitly** instructs: first line is `## Part {{Index}}`, exact format, no variation.

6.2. Polish / review / fix-problems nodes downstream of the header-producing node **explicitly** instruct: do not remove, modify, or shift the level of the header.

6.3. Merge nodes between them are configured `fixHeaders: false`, `includeNodeTitle: false`, `includeInputTitles: false` (so they don't reshape the embedded headers).

---

## 7. Continuity-without-mimicry instructions

For text nodes that receive prev-outputs (full prior scenes), the prompt must explicitly state:

7.1. The prior scenes are for **meaning / continuity**, **not** for copying stylistics or fragments verbatim. Without this, the model produces echo-prose by lifting phrasings.

7.2. The prompt also names what the prev-outputs are for in practical terms: "to avoid contradicting what was already written, to avoid repeating metaphors, to keep names straight".

---

## 8. Fanfic vs original branching

For templates that can be instantiated with both fanfic and original synopses:

8.1. A dedicated top-level node identifies the case (canon vs original) and emits a clearly distinguishable output.

8.2. Downstream nodes that need to behave differently in each case have explicit "if-canon / if-original" branches in their prompts.

8.3. The fanfic branch instructs the model to be **faithful to canon** (don't invent facts that contradict source material).

---

## 9. Language consistency

9.1. For locale-specific templates (e.g. `*.ru.json`), all prompts, descriptions, labels, and placeholders are in that language. No accidental fragments of another language inside prompt prose. Placeholders that happen to be node titles in another language are allowed since they reflect node identity; foreign-language prose inside instruction text is not.

9.2. Register is consistent — e.g. either consistently informal or consistently neutral. Current convention for Russian templates: imperative neutral, no pronoun.

---

## 10. Output format constraints

10.1. When the LLM should produce a specific format (numbered list, h2 headers, JSON), the prompt **explicitly** states the format.

10.2. Forbidden patterns are stated when relevant: "no bullets", "no numbering", "no opening or closing remarks", "output ONLY the result, no wrapper text".

10.3. For fix-problems' `aiUserInstructionsToFixProblems`, the prompt explicitly says "output only the corrected text" (or analog) — otherwise the model wraps with "Here is the corrected version:" prefixes.

---

## How to use this list

When auditing:
- Walk through every LLM-calling node of the template.
- For each rule, note pass / fail / N/A (e.g. rule 5 is N/A for nodes that don't generate structured lists).
- Report failures with file:node:rule and the minimal change to pass.
- Don't fix in the same pass as the audit — first write the findings, then fix them (so the audit can be reviewed before changes).

If you find yourself wishing for a rule that could be automated (a regex pattern, a structural property), add it to [`templates-structure.test.ts`](./templates-structure.test.ts) instead of here.
