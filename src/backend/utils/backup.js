const fs = require('fs')
const path = require('path')

/**
 * Creates a backup of a project database file
 * @param {string} dbPath - Path to the database file to backup
 * @returns {string} - Path to the created backup file
 */
function createBackup(dbPath) {
  // Ensure backups directory exists
  const backupsDir = path.join(process.cwd(), 'data', 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  
  // Get the filename without extension for the backup name
  const filename = path.basename(dbPath)
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${filename}.${ts}.bak`
  const backupPath = path.join(backupsDir, backupName)
  
  // Create backup by copying the file
  fs.copyFileSync(dbPath, backupPath)
  
  // Trim backups to last 7
  trimBackups(filename, backupsDir)
  
  return backupPath
}

/**
 * Trims backups to keep only the last 7
 * @param {string} filename - Base filename to match
 * @param {string} backupsDir - Directory containing backups
 */
function trimBackups(filename, backupsDir) {
  try {
    const all = fs.readdirSync(backupsDir).filter(f => f.startsWith(filename + '.'))
    all.sort()
    while (all.length > 7) {
      const rm = all.shift()
      try { fs.unlinkSync(path.join(backupsDir, rm)) } catch (e) {}
    }
  } catch (e) {
    // Ignore errors in trimming
  }
}

/**
 * Gets the most recent backup for a database file
 * @param {string} dbPath - Path to the database file
 * @returns {string|null} - Path to the most recent backup or null if none found
 */
function getLatestBackup(dbPath) {
  const backupsDir = path.join(process.cwd(), 'data', 'backups')
  if (!fs.existsSync(backupsDir)) return null
  
  const filename = path.basename(dbPath)
  try {
    const all = fs.readdirSync(backupsDir).filter(f => f.startsWith(filename + '.'))
    if (all.length === 0) return null
    
    all.sort()
    return path.join(backupsDir, all[all.length - 1])
  } catch (e) {
    return null
  }
}

module.exports = {
  createBackup,
  trimBackups,
  getLatestBackup
}