import type { AiEngineConfig, GrokEngineConfig, YandexEngineConfig } from "../../shared/ai-engine-config.js"
import { BUILTIN_ENGINES } from "../../shared/ai-engines.js"
import { SettingsRepository } from "../settings/settings-repository.js"

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function setCurrentEngine(engine: string | null): { ok: boolean } {
  if (engine != null) {
    const config = SettingsRepository.getAllAiEnginesConfig()
    const engineDef = BUILTIN_ENGINES.find((x) => x.id === engine)
    if (!engineDef) throw makeError(`Unknown engine: ${engine}`, 400)

    const missing: string[] = []
    for (const field of engineDef.configFields) {
      if (field.required) {
        if (!config[field.key]) missing.push(field.key)
      }
    }
    if (missing.length > 0) {
      throw makeError(`Missing required fields for ${engine}: ${missing.join(", ")}`, 400)
    }
  }

  SettingsRepository.setCurrentBackend(engine)
  return { ok: true }
}

export function getEngineModels(engine: string): { models: string[] } {
  const config = SettingsRepository.getAllAiEnginesConfig()
  let models: string[] = []
  if (engine === "yandex") models = config.yandex?.available_models ?? []
  else if (engine === "grok") models = config.grok?.available_models ?? []
  return { models }
}

export async function refreshEngineModels(engine: string) {
  const config = SettingsRepository.getAllAiEnginesConfig()
  let models: string[] = []

  if (engine === "yandex") {
    const engineConfig = config.yandex as YandexEngineConfig | undefined
    const apiKey = engineConfig?.api_key?.trim()
    const folderId = engineConfig?.folder_id?.trim()
    if (!apiKey || !folderId) {
      throw makeError("Yandex api_key and folder_id are required", 400)
    }
    const r = await fetch("https://ai.api.cloud.yandex.net/v1/models", {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "x-folder-id": folderId,
      },
    })
    if (!r.ok) {
      const body = await r.text()
      throw makeError(`Yandex API error ${r.status}: ${body}`, 502)
    }
    const data = (await r.json()) as { data?: { id: string }[] }
    models = (data.data ?? []).map((m) => m.id).filter((id) => id.startsWith("gpt://"))
    config.yandex = { ...engineConfig, available_models: models }
  } else if (engine === "grok") {
    const engineConfig = config.grok as GrokEngineConfig | undefined
    const apiKey = engineConfig?.api_key?.trim()
    if (!apiKey) throw makeError("Grok api_key is required", 400)
    const r = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!r.ok) {
      const body = await r.text()
      throw makeError(`Grok API error ${r.status}: ${body}`, 502)
    }
    const data = (await r.json()) as { data?: { id: string }[] }
    models = (data.data ?? []).map((m) => m.id)
    config.grok = { ...engineConfig, available_models: models }
  } else {
    throw makeError(`Model refresh not supported for engine '${engine}'`, 400)
  }

  SettingsRepository.saveAllAiEnginesConfig(config)
}

export async function testEngineConnection(
  engineId: string,
  creds: AiEngineConfig,
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    if (engineId === "grok") {
      const apiKey = creds.api_key?.trim()
      if (!apiKey) throw makeError("api_key is required", 400)

      const r = await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (r.ok) {
        const data = (await r.json()) as { data?: unknown[] }
        const count = Array.isArray(data.data) ? data.data.length : 0
        return { ok: true, detail: `Connected. ${count} model(s) available.` }
      } else {
        const body = await r.text()
        return { ok: false, error: `HTTP ${r.status}: ${body}` }
      }
    } else if (engineId === "yandex") {
      const apiKey = creds.api_key?.trim()
      const folderId = creds.folder_id?.trim()
      if (!apiKey) throw makeError("api_key is required", 400)
      if (!folderId) throw makeError("folder_id is required", 400)

      const r = await fetch("https://ai.api.cloud.yandex.net/v1/models", {
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          "x-folder-id": folderId,
        },
      })
      if (r.ok) {
        const data = (await r.json()) as { data?: unknown[] }
        const count = Array.isArray(data.data) ? data.data.length : 0
        return { ok: true, detail: `Connected. ${count} model(s) available.` }
      } else {
        const body = await r.text()
        return { ok: false, error: `HTTP ${r.status}: ${body}` }
      }
    } else {
      return { ok: false, error: `Unknown engine: ${engineId}` }
    }
  } catch (e: any) {
    if (e.status) throw e // re-throw our own errors
    return { ok: false, error: String(e) }
  }
}
