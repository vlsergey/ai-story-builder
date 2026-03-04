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
 */

export type AgeRating = 'G' | 'PG' | '12' | '16' | '18' | 'NC21'

export interface AgeRatingInfo {
  label: string
  longLabel: string
  minAge: number
  colorClass: string
}

export const AGE_RATING_INFO: Record<AgeRating, AgeRatingInfo> = {
  G:    { label: 'G',     longLabel: 'All Ages',       minAge: 0,  colorClass: 'bg-green-600 text-white' },
  PG:   { label: 'PG',   longLabel: 'Ages 7+',         minAge: 7,  colorClass: 'bg-lime-600 text-white' },
  '12': { label: '12+',  longLabel: 'Ages 12+',        minAge: 12, colorClass: 'bg-yellow-500 text-black' },
  '16': { label: '16+',  longLabel: 'Ages 16+',        minAge: 16, colorClass: 'bg-orange-500 text-white' },
  '18': { label: '18+',  longLabel: 'Adults Only',     minAge: 18, colorClass: 'bg-red-600 text-white' },
  NC21: { label: 'NC-21',longLabel: 'Adults Only 21+', minAge: 21, colorClass: 'bg-purple-800 text-white' },
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
  label: string
  type: 'text' | 'password' | 'textarea'
  /** Default value shown when no saved value exists. */
  defaultValue?: string
  /** Optional help text shown below the field. */
  hint?: string
}

export interface AiEngineDefinition {
  id: string
  name: string
  provider: string
  capabilities: AiEngineCapabilities
  ageRating: AgeRating
  configFields: AiEngineConfigField[]
  notes?: string
}

/** Capability metadata for display in the UI. */
export const CAPABILITY_META: Array<{
  key: keyof AiEngineCapabilities
  label: string
  description: string
}> = [
  {
    key: 'fileUpload',
    label: 'File Upload',
    description:
      'Upload documents (PDF, TXT, etc.) to persistent AI storage. Uploaded files can be reused across multiple requests without re-uploading.',
  },
  {
    key: 'fileAttachment',
    label: 'File Attachment',
    description:
      'Reference an uploaded file in a specific request so the model can read its contents directly.',
  },
  {
    key: 'knowledgeBase',
    label: 'Knowledge Base',
    description:
      'Build a searchable vector or hybrid index from uploaded files (RAG — Retrieval-Augmented Generation). Also called: Vector Store, SearchIndex, Collection.',
  },
  {
    key: 'knowledgeBaseAttachment',
    label: 'Knowledge Base Attachment',
    description:
      'Attach a pre-built Knowledge Base (vector store / search index) to a generation request so the model automatically retrieves relevant context from it. ' +
      'Also called: Search Index Tool (Yandex), Collections Search Tool (xAI Grok), file_search (OpenAI).',
  },
]

/** Built-in AI engine definitions. */
export const BUILTIN_ENGINES: AiEngineDefinition[] = [
  {
    id: 'grok',
    name: 'Grok AI',
    provider: 'xAI',
    ageRating: 'NC21',
    capabilities: {
      fileUpload: true,
      fileAttachment: true,
      knowledgeBase: false,
      knowledgeBaseAttachment: false,
    },
    configFields: [
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    notes: 'Maximum 10 files per request. No vector/collection search.',
  },
  {
    id: 'yandex',
    name: 'Yandex Cloud AI',
    provider: 'Yandex',
    ageRating: '12',
    capabilities: {
      fileUpload: true,
      fileAttachment: true,
      knowledgeBase: true,
      knowledgeBaseAttachment: true,
    },
    configFields: [
      { key: 'api_key',   label: 'API Key',   type: 'password' },
      { key: 'folder_id', label: 'Folder ID', type: 'text',
        hint: 'Your Yandex Cloud folder ID (e.g. b1gXXXXXXXXXX). Models use URI: gpt://{folder_id}/{model}/latest' },
    ],
    notes: 'Subject to Russian Federation content regulations. No LGBTQ+ or political content.',
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
