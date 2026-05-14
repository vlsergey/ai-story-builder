import z, { type ZodObject, type ZodType } from "zod"
import { AGE_RATING_ORDER } from "./ai-engines"
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
        case "select-age-rating":
          // Values come from shared/ai-engines.ts AGE_RATING_ORDER, not from
          // the template — the template only picks a default.
          result = z.enum(AGE_RATING_ORDER as readonly string[] as [string, ...string[]])
          break
      }
      return [field.name, result]
    }),
  )
  return z.object(zObjectArgs)
}
