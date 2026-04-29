import z, { type ZodObject, type ZodType } from "zod"
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
      }
      return [field.name, result]
    }),
  )
  return z.object(zObjectArgs)
}
