/**
 * AI engine definitions: built-in engines with their capabilities and age ratings.
 * Canonical source of truth — used by both the backend (logic) and the frontend (UI).
 *
 * Capabilities use industry-standard terminology:
 *   - fileUpload:              Upload documents to persistent AI storage (reusable across requests)
 *   - fileAttachment:          Reference an uploaded file in a specific request
 *   - knowledgeBase:           Build a searchable vector/hybrid index (RAG corpus / Vector Store / SearchIndex)
 *   - knowledgeBaseAttachment: Attach a pre-built Knowledge Base (vector store) to a generation request
 *                              for automatic retrieval (RAG grounding). Yandex: Search Index Tool;
 *                              xAI Grok: Collections Search Tool; OpenAI: file_search tool.
 *
 * Age ratings use a 6-level scale loosely inspired by MPAA:
 *   G / PG / 12 / 16 / 18 / NC21
 *
 * Display strings (name, notes, field labels/hints, capability labels/descriptions, age rating long labels)
 * are intentionally absent — they live in the frontend i18n locale files (src/frontend/src/i18n/).
 */

export type AgeRating = 'G' | 'PG' | '12' | '16' | '18' | 'NC21'

export interface AgeRatingInfo {
  /** Short rating code shown as a badge (e.g. "G", "18+"). Not translated. */
  label: string
  minAge: number
  /** Background color hex for the badge (used as inline style to avoid Tailwind purging). */
  bg: string
  /** Text color hex for the badge (used as inline style). */
  fg: string
}

/** All age ratings in ascending order of maturity. */
export const AGE_RATING_ORDER: AgeRating[] = ['G', 'PG', '12', '16', '18', 'NC21']

export const AGE_RATING_INFO: Record<AgeRating, AgeRatingInfo> = {
  G:    { label: 'G',      minAge: 0,  bg: '#16a34a', fg: '#fff' }, // green-600
  PG:   { label: 'PG',    minAge: 7,  bg: '#65a30d', fg: '#fff' }, // lime-600
  '12': { label: '12+',   minAge: 12, bg: '#eab308', fg: '#000' }, // yellow-500
  '16': { label: '16+',   minAge: 16, bg: '#f97316', fg: '#fff' }, // orange-500
  '18': { label: '18+',   minAge: 18, bg: '#dc2626', fg: '#fff' }, // red-600
  NC21: { label: 'NC-21', minAge: 21, bg: '#6b21a8', fg: '#fff' }, // purple-800
}

export interface AiEngineCapabilities {
  /** Upload documents to persistent AI storage. */
  fileUpload: boolean
  /** Attach uploaded files to specific requests. */
  fileAttachment: boolean
  /**
   * Build a searchable vector/hybrid index from uploaded files.
   * Also called: Vector Store (OpenAI), Collection (xAI), SearchIndex (Yandex).
   */
  knowledgeBase: boolean
  /**
   * Attach a pre-built Knowledge Base (vector store) to a generation request for automatic retrieval.
   * Also called: Search Index Tool (Yandex), Collections Search Tool (xAI Grok), file_search (OpenAI).
   */
  knowledgeBaseAttachment: boolean
}

export interface AiEngineConfigField {
  key: string
  type: 'text' | 'password' | 'textarea'
  /** Default value pre-filled in the field when no saved value exists. */
  defaultValue?: string
}

export interface AiEngineDefinition {
  id: string
  /** Provider proper name (e.g. "xAI", "Yandex"). Not translated — it is a brand name. */
  provider: string
  capabilities: AiEngineCapabilities
  ageRating: AgeRating
  configFields: AiEngineConfigField[]
  /**
   * Maximum number of files that can be attached to a single request, or null if unlimited.
   * When set and the engine supports fileUpload + fileAttachment, the lore tree is collapsed
   * to at most this many files before uploading (level-2 collapse).
   */
  maxFilesPerRequest: number | null
}

/** Capability keys in display order. Labels and descriptions are in i18n locale files. */
export const CAPABILITY_KEYS: Array<keyof AiEngineCapabilities> = [
  'fileUpload',
  'fileAttachment',
  'knowledgeBase',
  'knowledgeBaseAttachment',
]

/** Built-in AI engine definitions. */
export const BUILTIN_ENGINES: AiEngineDefinition[] = [
  {
    id: 'grok',
    provider: 'xAI',
    ageRating: 'NC21',
    capabilities: {
      fileUpload: true,
      fileAttachment: true,
      knowledgeBase: false,
      knowledgeBaseAttachment: false,
    },
    configFields: [
      { key: 'api_key', type: 'password' },
    ],
    maxFilesPerRequest: 10,
  },
  {
    id: 'yandex',
    provider: 'Yandex',
    ageRating: '12',
    capabilities: {
      fileUpload: true,
      fileAttachment: true,
      knowledgeBase: true,
      knowledgeBaseAttachment: true,
    },
    configFields: [
      { key: 'api_key',   type: 'password' },
      { key: 'folder_id', type: 'text' },
    ],
    maxFilesPerRequest: null,
  },
]

/** Returns the capabilities of the given engine, or null if unknown. */
export function getEngineCapabilities(engineId: string | null | undefined): AiEngineCapabilities | null {
  if (!engineId) return null
  return BUILTIN_ENGINES.find(e => e.id === engineId)?.capabilities ?? null
}

/** Returns true if the given engine (by id) supports file upload. Unknown engine ids return false. */
export function engineSupportsFileUpload(engineId: string | null | undefined): boolean {
  return getEngineCapabilities(engineId)?.fileUpload ?? false
}

/** Returns true if the given engine supports attaching a pre-built Knowledge Base during generation. */
export function engineSupportsKnowledgeBaseAttachment(engineId: string | null | undefined): boolean {
  return getEngineCapabilities(engineId)?.knowledgeBaseAttachment ?? false
}
