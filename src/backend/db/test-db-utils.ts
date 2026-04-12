import { migrateDatabase } from './migrations.js'
import * as DbState from './state.js'

/**
 * Функция, которую следует вызывать в beforeEach теста.
 * Сбрасывает состояние базы данных (закрывает соединение, очищает путь).
 */
export function setUpTestDb(migrate: boolean = true) {
  DbState.setCurrentDbPath(null)
  DbState.setCurrentDbPath(':memory:')
  if (migrate) {
    migrateDatabase(DbState.getCurrentDb())
  }
}

export function tearDownTestDb() {
  DbState.setCurrentDbPath(null)
}
