import { AiEngineKey } from '../../shared/ai-engines.js';
import { AiGenerationSettings } from '../../shared/ai-generation-settings.js';
import { withDbRead, withDbWrite } from '../db/connection.js';
import type { Database } from 'better-sqlite3';
import { AiEngineConfig, AllAiEnginesConfig } from '../../shared/ai-engine-config.js'

/**
 * Repository for accessing and modifying the `settings` table.
 * All methods assume a project is open (throws otherwise).
 */
export class SettingsRepository {
  /**
   * Get a raw string value by key.
   * Returns null if the key does not exist.
   */
  static get(key: string): string | null {
    return withDbRead((db: Database) => {
      const row = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return row ? row.value : null;
    });
  }

  /**
   * Set a raw string value for a key.
   * Creates or replaces the entry.
   */
  static set(key: string, value: string): void {
    withDbWrite((db: Database) => {
      db
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(key, value);
    });
    console.info(`Updated setting '${key}' to '${value?.substring(0, 15)}...'`)
  }

  /**
   * Get a JSON-parsed value by key.
   * Returns null if the key does not exist or parsing fails.
   */
  static getJson<T>(key: string): T | null {
    const raw = this.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set a JSON-serializable value for a key.
   */
  static setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  /**
   * Delete a key from settings.
   */
  static delete(key: string): void {
    withDbWrite((db: Database) => {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    });
  }

  // ─── Specialized getters/setters ──────────────────────────────────────────────

  static getLayout(): unknown {
    return this.getJson('layout');
  }

  static saveLayout(layout: unknown): void {
    this.setJson('layout', layout);
  }

  static getVerboseAiLogging(): boolean {
    const val = this.get('verbose_ai_logging');
    return val === 'true';
  }

  static setVerboseAiLogging(enabled: boolean): void {
    this.set('verbose_ai_logging', enabled ? 'true' : 'false');
  }

  static getAllAiEnginesConfig(): AllAiEnginesConfig {
    return this.getJson<AllAiEnginesConfig>('ai_config') ?? {};
  }

  static getCurrentEngineConfig() : AiEngineConfig {
    const engine = SettingsRepository.getCurrentBackend()
    if (!engine) return {}
    return this.getAllAiEnginesConfig()[engine] ?? {}
  }

  static getCurrentEngineAvailableModels(): string[] {
    return SettingsRepository.getCurrentEngineConfig().available_models ?? []
  }

  static getCurrentEngineDefaultAiGenerationSettings(): AiGenerationSettings {
    return SettingsRepository.getCurrentEngineConfig().defaultAiGenerationSettings ?? {}
  }

  static getCurrentEngineSummaryAiGenerationSettings(): AiGenerationSettings {
    return SettingsRepository.getCurrentEngineConfig().summaryAiGenerationSettings ?? {}
  }

  static getDefaultAiSettings() : AiGenerationSettings {
    return SettingsRepository.getCurrentEngineConfig()?.defaultAiSettings ?? {}
  }

  static saveAllAiEnginesConfig(config: AllAiEnginesConfig): void {
    this.setJson('ai_config', config);
  }

  static getCurrentBackend(): AiEngineKey | null {
    return this.get('current_backend');
  }

  static setCurrentBackend(engine: string | null): void {
    if (engine === null) {
      this.delete('current_backend');
    } else {
      this.set('current_backend', engine);
    }
  }

  static getTextLanguage(): string | null {
    return this.get('text_language');
  }

  static setTextLanguage(lang: string | null): void {
    if (lang === null) {
      this.delete('text_language');
    } else {
      this.set('text_language', lang);
    }
  }

  static getAutoGenerateSummary(): boolean {
    const val = this.get('auto_generate_summary');
    return val === 'true';
  }

  static setAutoGenerateSummary(enabled: boolean): void {
    this.set('auto_generate_summary', enabled ? 'true' : 'false');
  }

  static getProjectTitle(): string | null {
    return this.get('project_title');
  }

  static setProjectTitle(title: string | null): void {
    if (title === null) {
      this.delete('project_title');
    } else {
      this.set('project_title', title);
    }
  }

  /**
   * Get a setting value with a fallback default.
   */
  static getWithDefault(key: string, defaultValue: string): string {
    const val = this.get(key);
    return val ?? defaultValue;
  }

  /**
   * Get a JSON setting with a fallback default.
   */
  static getJsonWithDefault<T>(key: string, defaultValue: T): T {
    const val = this.getJson<T>(key);
    return val ?? defaultValue;
  }

}