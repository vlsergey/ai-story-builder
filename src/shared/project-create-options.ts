import z from "zod"

export const PROJECT_CREATE_OPTIONS_SCHEMA = z.object({
  title: z.string().min(1).max(128),
  templateFilePath: z.string().nullable(),
  templateData: z.record(z.string(), z.any()),
})

export type ProjectCreateOptions = z.infer<typeof PROJECT_CREATE_OPTIONS_SCHEMA>
