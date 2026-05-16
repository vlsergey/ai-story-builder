import z, { type ZodObject, type ZodType } from "zod"
import { AGE_RATING_INFO, AGE_RATING_ORDER } from "./ai-engines"
import type { WizardField } from "./project-template"

export function buildFormSchema(wizardFields: WizardField[]): ZodObject<Record<string, ZodType>> {
  const zObjectArgs = Object.fromEntries(
    wizardFields.map((field) => {
      let result: ZodType = z.any()
      switch (field.type) {
        case "input":
          result = z.string()
          break
        case "textarea":
          result = z.string()
          break
        case "select-age-rating": {
          // Wizard stores the human-readable badge label ("G", "PG", "12+",
          // "16+", "18+", "NC-21") so templates can use ${ageRating} as a
          // standard substitution — no derivation step. The badge label is
          // the canonical user-facing form; the AGE_RATING_ORDER codes
          // ("12", "16", "NC21", …) are an internal ordering / capability
          // key independent of what the wizard collects.
          const labels = AGE_RATING_ORDER.map((rating) => AGE_RATING_INFO[rating].label)
          result = z.enum(labels as [string, ...string[]])
          break
        }
        case "integer":
          result = z.coerce.number().int().min(field.min).max(field.max)
          break
      }
      return [field.name, result]
    }),
  )
  return z.object(zObjectArgs)
}
