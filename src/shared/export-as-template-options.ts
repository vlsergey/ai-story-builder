import * as z from "zod"

export const exportProjectAsTemplateOptionsSchema = z.object({
  filePath: z.string(),
  exportLoreStructure: z.boolean().default(false),
})

export type ExportProjectAsTemplateOptions = z.infer<typeof exportProjectAsTemplateOptionsSchema>
