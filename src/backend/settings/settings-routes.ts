import { setVerboseLogging } from '../lib/ai-logging.js';
import { SettingsRepository } from './settings-repository.js';

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message);
  (e as any).status = status;
  return e;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function getLayout(): unknown {
  return SettingsRepository.getLayout();
}

export function saveLayout(layout: unknown): { ok: boolean } {
  if (!layout) throw makeError('layout required, db must be open', 400);
  SettingsRepository.saveLayout(layout);
  return { ok: true };
}

export function setVerboseAiLogging(value: unknown): { ok: boolean } {
  if (value === undefined) throw makeError('value required, db must be open', 400);
  const strValue = String(value);
  SettingsRepository.setVerboseAiLogging(strValue === 'true');
  setVerboseLogging(strValue === 'true');
  return { ok: true };
}

export function getSetting(key: string): { value: string | null } {
  return { value: SettingsRepository.get(key) };
}

export function setSetting(key: string, value: unknown): { ok: boolean } {
  if (value === undefined) throw makeError('value required, db must be open', 400);
  SettingsRepository.set(key, String(value));
  return { ok: true };
}
