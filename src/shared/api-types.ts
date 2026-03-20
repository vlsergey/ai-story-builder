/**
 * Shared TypeScript types for the AI Story Builder project.
 * These types are used by both the backend (tRPC procedures) and the frontend (tRPC client).
 */

export interface AiEngineConfig {
  api_key: string;
  available_models: string[];
  defaultAiSettings: Record<string, unknown>;
}

export interface AiConfigStore {
  grok?: AiEngineConfig;
  yandex?: AiEngineConfig;
  custom?: Record<string, AiEngineConfig>;
}

/** Request payload for saving AI configuration */
export interface SaveAiConfigRequest {
  engine: string;
  fields: Record<string, unknown>;
}

/** Response for setting the current AI engine */
export interface SetCurrentEngineRequest {
  engine: string | null;
}

/** Response for fetching AI engine models */
export interface EngineModelsResponse {
  models: string[];
}

/** Parameters for generating a plan */
export interface GeneratePlanParams {
  prompt?: string;
  mode?: string;
  baseContent?: string;
  aiGenerationSettings?: Record<string, unknown>;
  includeExistingLore?: boolean;
  nodeId?: number;
}

/** Result of a plan generation */
export interface GeneratePlanResult {
  response_id?: string;
  cost_usd_ticks?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}

/** Basic project information */
export interface ProjectInfo {
  path: string;
  layout: unknown;
  projectTitle: string | null;
}

/** Request payload for creating a new project */
export interface CreateProjectRequest {
  name?: string;
  text_language?: string;
}