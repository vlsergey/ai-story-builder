# Generated examples

End-to-end results of running the bundled templates on real synopses. Each file is a single Markdown document:

- A preamble (above the first heading) with the **full reproducibility surface**: template name, wizard inputs (age rating, synopsis, parts count, …), LLM engine + per-call settings, total run time, total cost.
- A `# <project name>` heading.
- The final assembled prose.

These are produced by [`scripts/export-project-to-md.ts`](../scripts/export-project-to-md.ts) run against a generated project's `.sqlite` and then copied here.

## Filename convention

```
<projectName> [<templateSlug>, <genre>, <partsCount> частей, <model>, <lang>].md
```

Tags are dropped when the underlying value is missing (older projects without persisted wizard data don't get a `<partsCount>` tag, etc.). Windows-illegal characters are stripped from the final filename.

## What to expect

Examples are **not** curated showcases — they're representative runs warts and all, useful for:
- Seeing how the template handles a specific genre / part-count combination.
- Reading the LLM settings + cost that produced this output, so you can predict your own run.
- Reproducing — synopsis is in the preamble; paste it into the wizard with the same settings.
