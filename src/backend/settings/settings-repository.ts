import type { Database } from "better-sqlite3"
import { withDbRead, withDbWrite } from "../db/connection.js"
import { type SettingDef, SettingsMap } from "./SettingDef.js"

/**
 * Repository for accessing and modifying the `settings` table.
 * All methods assume a project is open (throws otherwise).
 */
class BaseSettingsRepository {
  static get<T>(def: SettingDef<T>): T {
    const result = withDbRead((db: Database) => {
      const dbValue = db
        .prepare<[string], { value: string | null }>("SELECT value FROM settings WHERE key = ?")
        .get(def.key)
      const parsed = dbValue?.value ? JSON.parse(dbValue.value) : null
      return parsed == null ? def.defaultValue : parsed
    })
    console.debug(`Returning '${JSON.stringify(result)?.substring(0, 15)}...' as value of setting '${def.key}'`)
    return result
  }

  static set<T>(def: SettingDef<T>, value: T): void {
    if (value === null || value === def.defaultValue) {
      withDbWrite((db: Database) => {
        db.prepare<string>("DELETE FROM settings WHERE key = ?").run(def.key)
      })
      console.info(`Deleted setting '${def.key}'`)
    } else {
      withDbWrite((db: Database) => {
        db.prepare<[string, string]>("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
          def.key,
          JSON.stringify(value),
        )
      })
      console.info(`Updated setting '${def.key}' to '${JSON.stringify(value)?.substring(0, 15)}...'`)
    }
  }
}

type SettingsAccessors = {
  [K in keyof typeof SettingsMap as `get${Capitalize<string & K>}`]: () => (typeof SettingsMap)[K] extends SettingDef<
    infer T
  >
    ? T
    : never
} & {
  [K in keyof typeof SettingsMap as `set${Capitalize<string & K>}`]: (
    value: (typeof SettingsMap)[K] extends SettingDef<infer T> ? T : never,
  ) => void
}

for (const [key, def] of Object.entries(SettingsMap)) {
  const capName = key.charAt(0).toUpperCase() + key.slice(1)
  ;(BaseSettingsRepository as any)[`get${capName}`] = () => BaseSettingsRepository.get(def)
  ;(BaseSettingsRepository as any)[`set${capName}`] = (val: any) => BaseSettingsRepository.set(def, val)
}

// Приводим к типу, чтобы TS видел новые методы
export const SettingsRepository = BaseSettingsRepository as typeof BaseSettingsRepository & SettingsAccessors
