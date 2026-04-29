import z from "zod"

export const PROJECT_CREATE_OPTIONS_SCHEMA = z.object({
  title: z.string(),
  templatePath: z.string().optional(),
})

export type ProjectCreateOptions = z.infer<typeof PROJECT_CREATE_OPTIONS_SCHEMA>
