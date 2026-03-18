import { SettingsRepository } from '../settings/settings-repository.js';
import type { AiConfigStore, GrokEngineConfig, YandexEngineConfig } from '../lib/ai-engine-adapter.js';

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message);
  (e as any).status = status;
  return e;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readAiConfig(): AiConfigStore {
  return SettingsRepository.getAiConfig();
}

function writeAiConfig(config: AiConfigStore): void {
  SettingsRepository.saveAiConfig(config);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function getAiConfig(): { current_engine: string | null; grok: object; yandex: object } {
  const config = readAiConfig();
  return {
    current_engine: SettingsRepository.getCurrentBackend(),
    grok: {
      api_key: '',
      available_models: [],
      defaultAiSettings: {},
      ...(config.grok ?? {}),
    },
    yandex: {
      api_key: '',
      folder_id: '',
      available_models: [],
      defaultAiSettings: {},
      ...(config.yandex ?? {}),
    },
  };
}

export function saveAiConfig(data: { engine: string; fields: Record<string, unknown> }): { ok: boolean } {
  const { engine, fields } = data;
  if (!engine || !fields || typeof fields !== 'object') {
    throw makeError('engine and fields are required', 400);
  }
  const config = readAiConfig();
  if (engine === 'grok') {
    config.grok = { ...config.grok, ...fields };
  } else if (engine === 'yandex') {
    config.yandex = { ...config.yandex, ...fields };
  } else {
    // For custom engines, store under a 'custom' key
    if (!config.custom) config.custom = {};
    const custom = config.custom as any;
    custom[engine] = { ...(custom[engine] ?? {}), ...fields };
  }
  writeAiConfig(config);
  return { ok: true };
}

export function setCurrentEngine(data: { engine: string | null }): { ok: boolean } {
  const { engine } = data;

  if (engine != null) {
    const config = readAiConfig();
    const missing: string[] = [];
    if (engine === 'grok') {
      if (!config.grok?.api_key?.trim()) missing.push('api_key');
    } else if (engine === 'yandex') {
      if (!config.yandex?.api_key?.trim()) missing.push('api_key');
      if (!config.yandex?.folder_id?.trim()) missing.push('folder_id');
    }
    if (missing.length > 0) {
      throw makeError(`Missing required fields for ${engine}: ${missing.join(', ')}`, 400);
    }
  }

  SettingsRepository.setCurrentBackend(engine);
  return { ok: true };
}

export function getEngineModels(engine: string): { models: string[] } {
  const config = readAiConfig();
  let models: string[] = [];
  if (engine === 'yandex') models = config.yandex?.available_models ?? [];
  else if (engine === 'grok') models = config.grok?.available_models ?? [];
  return { models };
}

export async function refreshEngineModels(engine: string): Promise<{ models: string[] }> {
  const config = readAiConfig();
  let models: string[] = [];

  if (engine === 'yandex') {
    const apiKey = config.yandex?.api_key?.trim();
    const folderId = config.yandex?.folder_id?.trim();
    if (!apiKey || !folderId) {
      throw makeError('Yandex api_key and folder_id are required', 400);
    }
    const r = await fetch('https://ai.api.cloud.yandex.net/v1/models', {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'x-folder-id': folderId,
      },
    });
    if (!r.ok) {
      const body = await r.text();
      throw makeError(`Yandex API error ${r.status}: ${body}`, 502);
    }
    const data = (await r.json()) as { data?: { id: string }[] };
    models = (data.data ?? []).map((m) => m.id).filter((id) => id.startsWith('gpt://'));
    config.yandex = { ...config.yandex, available_models: models };

  } else if (engine === 'grok') {
    const apiKey = config.grok?.api_key?.trim();
    if (!apiKey) throw makeError('Grok api_key is required', 400);
    const r = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const body = await r.text();
      throw makeError(`Grok API error ${r.status}: ${body}`, 502);
    }
    const data = (await r.json()) as { data?: { id: string }[] };
    models = (data.data ?? []).map((m) => m.id);
    config.grok = { ...config.grok, available_models: models };

  } else {
    throw makeError(`Model refresh not supported for engine '${engine}'`, 400);
  }

  writeAiConfig(config);
  return { models };
}

export async function testEngineConnection(
  engine: string,
  creds: Record<string, string>
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    if (engine === 'grok') {
      const apiKey = creds['api_key']?.trim();
      if (!apiKey) throw makeError('api_key is required', 400);

      const r = await fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) {
        const data = (await r.json()) as { data?: unknown[] };
        const count = Array.isArray(data.data) ? data.data.length : 0;
        return { ok: true, detail: `Connected. ${count} model(s) available.` };
      } else {
        const body = await r.text();
        return { ok: false, error: `HTTP ${r.status}: ${body}` };
      }

    } else if (engine === 'yandex') {
      const apiKey = creds['api_key']?.trim();
      const folderId = creds['folder_id']?.trim();
      if (!apiKey) throw makeError('api_key is required', 400);
      if (!folderId) throw makeError('folder_id is required', 400);

      const r = await fetch('https://ai.api.cloud.yandex.net/v1/models', {
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'x-folder-id': folderId,
        },
      });
      if (r.ok) {
        const data = (await r.json()) as { data?: unknown[] };
        const count = Array.isArray(data.data) ? data.data.length : 0;
        return { ok: true, detail: `Connected. ${count} model(s) available.` };
      } else {
        const body = await r.text();
        return { ok: false, error: `HTTP ${r.status}: ${body}` };
      }

    } else {
      return { ok: false, error: `Unknown engine: ${engine}` };
    }
  } catch (e: any) {
    if (e.status) throw e; // re-throw our own errors
    return { ok: false, error: String(e) };
  }
}
