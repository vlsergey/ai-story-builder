import EventEmitter from "node:events"
import type { Observable } from "@trpc/server/observable"
import type { Database } from "better-sqlite3"
import {
  DB_SETTING_KEY_TO_SETTING_KEY,
  type GetSettingType,
  type SettingDef,
  type SettingKey,
  SettingsMap,
  type SettingsTypes,
} from "../../shared/settings.js"
import { withDbRead, withDbWrite } from "../db/connection.js"
import { emitterToObservable, emitterToSingleArgObservable } from "../lib/event-manager.js"

type EventChangeTuple<K extends SettingKey> = [key: K, value: GetSettingType<K>]

type AllSettingsEvents = {
  onChange: EventChangeTuple<SettingKey>
}

type SingleSettingsEvents = {
  [K in SettingKey]: [value: GetSettingType<K>]
}

interface SettingChangeEvent<K extends SettingKey> {
  key: K
  value: SettingsTypes[K]
}

/**
 * Repository for accessing and modifying the `settings` table.
 * All methods assume a project is open (throws otherwise).
 */
class BaseSettingsRepository {
  private static allSettingsEventEmitter = new EventEmitter<AllSettingsEvents>()
  private static singleSettingEventEmitter = new EventEmitter<SingleSettingsEvents>()

  static get<T>(def: SettingDef<T>): T {
    const result = withDbRead((db: Database) => {
      const dbValue = db
        .prepare<[string], { value: string | null }>("SELECT value FROM settings WHERE key = ?")
        .get(def.dbKey)
      const parsed = dbValue?.value ? JSON.parse(dbValue.value) : null
      return parsed == null ? def.defaultValue : parsed
    })
    console.debug(`Returning '${JSON.stringify(result)?.substring(0, 15)}...' as value of setting '${def.dbKey}'`)
    return result
  }

  static set<T>(def: SettingDef<T>, value: T): void {
    if (value === null || value === def.defaultValue) {
      withDbWrite((db: Database) => {
        db.prepare<string>("DELETE FROM settings WHERE key = ?").run(def.dbKey)
      })
      console.info(`Deleted setting '${def.dbKey}'`)
    } else {
      withDbWrite((db: Database) => {
        db.prepare<[string, string]>("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
          def.dbKey,
          JSON.stringify(value),
        )
      })
      console.info(`Updated setting '${def.dbKey}' to '${JSON.stringify(value)?.substring(0, 15)}...'`)
    }
    const eventKey = DB_SETTING_KEY_TO_SETTING_KEY[def.dbKey]
    BaseSettingsRepository.allSettingsEventEmitter.emit("onChange", eventKey, value)
    BaseSettingsRepository.singleSettingEventEmitter.emit(eventKey, value)
  }

  static subscribeToAll() {
    return emitterToObservable(BaseSettingsRepository.allSettingsEventEmitter, "onChange", ([key, value]) => ({
      key,
      value,
    }))
  }

  static subscribeToSingle<K extends string & keyof typeof SettingsMap>(
    settingKey: K,
  ): Observable<SettingsTypes[K], unknown> {
    return emitterToSingleArgObservable(BaseSettingsRepository.singleSettingEventEmitter, settingKey)
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
