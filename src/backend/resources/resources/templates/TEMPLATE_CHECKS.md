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

3.2. Within each prompt for a **content-generating** text/split/lore node, the task block (the instruction itself — static text, typically introduced by a "what to do" h2 heading) sits AFTER all input substitution sections. The cache benefit is marginal in production (the cache always breaks at the first dynamic placeholder regardless of task position) — the real win is at **template authoring time**: when the author iterates on the task wording but inputs stay constant, task-at-bottom keeps the cached prefix valid right up to the task.

   For **fix-problems** prompts the convention is reversed: a short task block on top, then the (typically large) substituted material. This is by design — the model needs to know the task before reading a multi-thousand-token block of content. Don't shoehorn fix-problems into the text-node ordering.

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

## 8. Continuity instructions

For text nodes that receive prev-outputs (full prior scenes / chapters / sections), the prompt must explicitly state both what NOT to do with the prior content AND what to actively USE from it. Without the active-use clause, the model treats prior content as inert reference and produces episodes that feel like standalone stories. Without the no-mimicry clause, the model produces echo-prose by lifting phrasings.

8.1. **No mimicry.** Prior content is for meaning / continuity, NOT for copying stylistics or fragments verbatim. Reference events, not text.

8.2. **Practical purpose named.** Spell out what prev-outputs are for in concrete terms: "to avoid contradicting what was already written, to avoid repeating metaphors, to keep names straight".

8.3. **Active engagement required.** The prompt names specific behaviours that must connect the new piece to prior pieces, not just permit it. Concrete demands that have proven necessary in practice:

   - **Emotional carry-over** — the new piece starts from the emotional state the previous piece ended in (not "back to neutral").
   - **Named callbacks** — at least one explicit reference to a specific event, decision, line, or object from prior pieces (not vague "earlier"; named anchors).
   - **Relationship memory** — characters' interactions carry the weight of prior interactions in subtext, even if not spelled out.
   - **Open setups tracking** — unresolved setups from prior pieces either pay off in this one or remain visibly charged.

   The model can fulfil 8.1 + 8.2 without doing any of 8.3 — it simply writes a clean standalone episode in the right style and gets it past the mimicry check. 8.3 is what makes the arc feel like an arc.

---

## 9. Language consistency

9.1. For locale-specific templates (e.g. `*.ru.json`), all prompts, descriptions, labels, and placeholders are in that language. No accidental fragments of another language inside prompt prose. Placeholders that happen to be node titles in another language are allowed since they reflect node identity; foreign-language prose inside instruction text is not.

   **Instruction language leaks into output.** The LLM mirrors the vocabulary it sees in the prompt — English terms ("setup", "payoff", "callback", "POV", "Disaster", "flashback", "action", "engage") in instructions show up as the same English words inside the model's generated prose, even when an explicit "write in Russian" rule is present at the end. Acceptable exceptions: methodology proper nouns ("Save the Cat", "Свейн") *with* localized attribution (`по Свейну`), and code identifiers inside fenced blocks. Mixing English meta-vocabulary with target-language content prose in the same instruction is the most common leak source. When you reach for an English term to describe an authoring concept, find or coin a target-language word for it instead.

9.2. Register is consistent — e.g. either consistently informal or consistently neutral. Current convention for Russian templates: imperative neutral, no pronoun.

9.3. No `if`-style branches in instruction text (in any language — "if X then A, otherwise B" patterns confuse the model). Rewrite imperatively: state the desired action for each case as a separate sentence ("Canonical characters — canonical voice. New characters — invent.") instead of "if X then A, if Y then B".

---

## 10. Output format constraints

10.1. When the LLM should produce a specific format (numbered list, h2 headers, JSON), the prompt **explicitly** states the format.

10.2. Forbidden patterns are stated when relevant: "no bullets", "no numbering", "no opening or closing remarks", "output ONLY the result, no wrapper text".

10.3. For fix-problems' `aiUserInstructionsToFixProblems`, the prompt explicitly says "output only the corrected text" (or analog) — otherwise the model wraps with "Here is the corrected version:" prefixes.

10.4. **Fix-problems nodes in locale-specific templates check for foreign-language insertions.** The model frequently slips untranslated English terms ("point of view", "mid-act twist"), non-localized proper nouns, or latin-script fragments into otherwise-target-language text. Every fix-problems node's find-step list should include "foreign-language insertions" as a problem class with severity ≥ 70 so the fix-step deals with them.

10.5. **Profile / character-sheet nodes explicitly forbid invented example quotes.** When a profile describes how a character speaks, listing example phrases ("often says: …", "favourite line: …") causes the model to recycle those exact strings verbatim into every later scene that character appears in. Describe voice as tendencies and techniques (rhythm, vocabulary, defensive verbal habits), not as a catalog of stock phrases. Quotes from an established canon (when the character is borrowed from a source named in the world description) are fine — they must already exist in the wider corpus the model has access to and should be marked as such (e.g. with a "canon:" prefix).

10.6. **Classification / analysis / planning nodes (anything whose job is to describe ABOUT the work rather than write the work) explicitly forbid story prose.** Without this, when the prompt includes a synopsis or scene plan, the model can slide into writing the story itself — especially when given high word ceilings or the word "prose" anywhere in the instruction. The forbidding sentence should name the slippage concretely — e.g. "this is classification, not the work itself: do not write prose, do not compose scenes, do not produce dialogue" (in the template's language). Applies to: theme, genre, world description, character profile, scene plan, director notes, plot outline, setup/payoff registry, fix-problems find-step.

---

## 11. Per-iteration generation discipline

For per-iteration nodes inside a for-each — the ones that emit ONE element of a sequence per call (one scene, one chapter, one section):

11.1. **Exactly one element per call, explicitly stated.** When such a node has prior elements assembled in its context (a prev-outputs merge, or the full prior draft for a rewrite pass), the model often reads the `## Part 1 … ## Part 2 …` pattern there as a template to continue and emits Parts `{{Index}}`, `{{Index}}+1`, `{{Index}}+2` … in one response. The prompt must explicitly state: "exactly ONE Part — Part `{{Index}}` — stop after its last sentence; no `## Part {{Index}}+1`, no epilogue, no teaser for following parts". The downstream find-problems node (if any) must list "more than one `## Part N` header in the output" as a problem with severity ≥ 90 so the fix step truncates the excess.

11.2. **Iteration index appears prominently as a placeholder.** The current iteration index is part of every header (`## Part {{Index}}`) and ideally also in the task block ("write Part `{{Index}}` and only it"). Burying the index inside a sentence three paragraphs in invites the model to miss it.

11.3. **The header format is identical in the producer prompt and downstream consumer prompts.** If producer says `## Часть {{Index}}` and consumer looks for `## Часть {{Index}}`, that's fine. If consumer looks for `## Part {{Index}}` (drift), the navigation by header in the downstream node silently breaks. See also 7.1 / 7.2.

---

## 12. Age-rating gate

12.1. Templates that declare an age-rating wizard field (`select-age-rating`) receive a derived `${ageRatingLabel}` variable that the apply pipeline substitutes into prompts. Every LLM-call node's prompt fields must reference this variable. Without it, the model:
   - refuses on a content filter for genuinely-allowed-by-rating topics (CSAM-class false positives — the model can't tell mature is OK if you never told it), OR
   - over-corrects toward sanitised prose even on permitted topics.

   Typical pattern at the very top of each prompt: `## Возрастной рейтинг произведения\n\n${ageRatingLabel}. <one sentence saying the content must stay in range>.`

   This rule is enforced by [`templates-structure.test.ts`](./templates-structure.test.ts) — see "LLM-call nodes reference the ageRatingLabel wizard var". The reverse is not enforced: templates without an age-rating field skip the check.

---

## 13. Severity bands for fix-problems

For `fix-problems` nodes, the find-step prompt asks the model to assign severity 0–100 to each problem and the engine fixes everything ≥ `minSeverityToFix`. Internal consistency matters: if the find-step's enumerated problem types all use severity 60–95 but `minSeverityToFix: 40`, the threshold is meaningless. If find-step assigns severities of 30 to real issues but `minSeverityToFix: 50`, those issues are detected and silently discarded.

13.1. **Document the severity bands the find-step uses** in the prompt itself, so the model has a consistent reference. A reasonable convention is:
   - 80–100: blocker. Structural / safety / "the output is unusable as-is" problems. (Wrong header. Wrong character. Foreign language insertion. Multi-scene overrun.)
   - 60–79: significant. Reader will notice and judge the work for it.
   - 40–59: polish. Worth fixing if cheap, not worth blocking on.
   - < 40: noise; don't surface.

13.2. **`minSeverityToFix` is at or below the bottom of the bands the find-step actually uses.** If find-step never assigns < 50, setting `minSeverityToFix: 30` just means the threshold is decorative.

13.3. **`maxIterations` matches the cost-benefit:** profile / setup nodes (cheap, low-risk) can afford 2–3 iterations; arc-spanning plan polish that's worth grinding can go to 10; scene-level polish where the fifth round adds nothing should cap at 2.

---

## 14. Multi-beat plot plan structure

Templates whose pipeline includes a node that produces a numbered sequence of N plot beats (each iterated downstream into a scene) need these guards. The model's default is to write N consecutive interior-reflection beats with a smooth emotional gradient and no concrete events. The result reads as one long thought, not an arc.

14.1. **Beat-type variety.** The plot-plan prompt should declare beat types and require that no more than one consecutive beat be of the same type. Types worth distinguishing: interior-only (POV alone, no dialogue, no external event), dialogue with one other character, dialogue with a group, action-without-dialogue, rendered flashback (not "she remembered" but a scene with location and lines). Without this rule the LLM lands every beat in interior-only — it's the cheapest type to write.

14.2. **Beat-ending must be eventful, not affective.** When the plot-plan prompt asks for Goal/Conflict/Disaster (Swain) or any equivalent, "Disaster" (the beat's ending) must be defined explicitly as a SHOWABLE event — a gesture, a line, an object appearing or disappearing, a movement, a change in surroundings. Forbid endings phrased as internal recognition ("she felt", "realized", "decided to think later"). The downstream find-problems node lists "beat ends on affect, not event" as a severity ≥ 70 problem.

14.3. **Final beat carries a concrete gesture.** The plot-plan prompt must require the final beat to contain a single, in-the-moment physical action symbolizing the protagonist's choice. Forbid endings of the form "decides to think about it later", "leaves without resolving", "still doesn't understand". Without this, novellas end on internal recognition that doesn't satisfy.

14.4. **Material follow-up for key reveals.** When the plot plan reveals a key piece of information (name, fact, artifact, confession) in beat N, at least one later beat must re-touch that information through a physical proof: object, second document, third-party line, external event. Repeated POV reflection on the same information is retelling, not a payoff.

14.5. **On-stage characters only get full profiles.** Templates with a character-profiles for-each must not produce full profiles for characters who never appear on stage. Either (a) generate the plot first and derive the cast from beats where characters actually act/speak/are seen, or (b) instruct the cast-extraction node to filter to on-stage characters and emit a one-line reference for the rest. Otherwise the for-each burns LLM cycles on character development the prose can't consume, and the plot-review find-step should flag "character with full profile never appears on stage" as severity ≥ 60.

14.6. **Deadline pressure must register in beats.** If the setting establishes a time constraint (an event, a deadline, a closing window), the plot-plan prompt must require that 2+ beats reflect it — thought of approaching event, accelerated pace, objective time marker, or conversation about time. Otherwise the deadline is decoration.

## 15. Setup / payoff registry distribution

If the template generates a setup/payoff registry alongside the plot plan, the prompt must constrain its shape:

15.1. **Every beat after the first gets at least one payoff.** A beat without any prior-setup payoff is exposition, not a scene. Find-step severity ≥ 60.

15.2. **No star-graph to the final beat.** No more than ~half of all rows may have the final beat as their payoff target. If most setups converge on the finale, the middle beats are filler. Find-step severity ≥ 65.

15.3. **Setups have a payoff distance bound.** A setup planted in beat K should pay off no later than K + ⌈N / 3⌉ (where N is the plan's beat count). Longer-distance "setups" are world-building context, not active promises — remove from the registry to avoid the model treating them as Chekhov's guns that must fire.

15.4. **No duplicate rows.** Two rows describing the same setup→payoff in different words is one row. Find-step severity ≥ 55.

15.5. **Concrete naming.** Both "what's planted" and "what fires" must name specific things — characters, objects, lines, actions. Abstractions like "the protagonist's loyalty / lets go of the burden" are theme restatements, not setup/payoff pairs.

## 16. Character voice distinguishability

For templates with a character-profile node (per-character profile with a "voice" / "speech" field):

16.1. **The voice field must contain a distinguishing marker.** At minimum one of: era of speech (vocabulary period, generation), profession (specialized jargon), formal/colloquial register, regional or social variant, specific verbal tic (interrupts / repeats / quotes / uses proverbs / drifts into elaboration). Without this constraint, every profile lands on the same default — "short phrases, pauses, concrete vocabulary" — and on the page all characters sound identical.

16.2. **Voices in the cast must not be synonymously described.** If two profiles in the same cast describe voice with paraphrases of the same idea, rewrite one. Best enforced by the plot-/cast-review find-step as severity ≥ 70: "two characters' voices share the same marker — pick a different axis for one."

16.3. **Profile prompts forbid invented example quotes.** Already covered by rule 10.5. The quote-trap is the most common failure mode for voice consistency — listing example lines causes the model to recycle them verbatim into every scene.

## 17. Scene plan engages with setting

For templates that have a per-scene planning node (between the plot plan and the prose generator):

17.1. **Each scene plan must engage with at least one concrete element of the setting** — a named object, location, time-of-day detail, weather marker. Generic references ("in the house", "outside") don't count. Without this, scenes float in unanchored space and feel interchangeable. For interior-only beats, the setting element appears as the anchor for the character's perception.

---

## How to use this list

When auditing:
- Walk through every LLM-calling node of the template.
- For each rule, note pass / fail / N/A (e.g. rule 6 is N/A for nodes that don't generate structured lists).
- Report failures with file:node:rule and the minimal change to pass.
- Don't fix in the same pass as the audit — first write the findings, then fix them (so the audit can be reviewed before changes).

If you find yourself wishing for a rule that could be automated (a regex pattern, a structural property), add it to [`templates-structure.test.ts`](./templates-structure.test.ts) instead of here.
