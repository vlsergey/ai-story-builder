import * as z from "zod"
import { AiEngineDefinition } from "./ai-engines"

export interface AiGenerationSettings {
  model?: string | undefined,
  [key: string]: any,
}

export const getAiGenerationSettingsSchema = (engineDef: AiEngineDefinition) => z.object({
  model: z.string().optional(),
  ...Object.fromEntries(
    (engineDef?.aiSettingsFields || []).map(field => field.schema
      ? [field.key, field.schema.optional()]
      : [field.key, z.string().optional()]
    )
  )
})
