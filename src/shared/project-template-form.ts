import z, { type ZodType } from "zod"
import type { ProjectTemplate } from "./project-template"

export function buildFormSchema(projectTemplate: ProjectTemplate) {
  const allField = (projectTemplate.wizardPages || []).flatMap((page) => page.fields || [])
  const zObjectArgs = Object.fromEntries(
    allField.map((field) => {
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
