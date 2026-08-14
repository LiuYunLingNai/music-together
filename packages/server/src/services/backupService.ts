import { cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupSettingsRepo } from '../repositories/backupSettingsRepository.js'
import { databasePath, db } from '../repositories/database.js'
import { logger } from '../utils/logger.js'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const dataDirectory = path.dirname(databasePath)
const backupDirectory = path.join(rootDirectory, 'backups')
const backupPrefix = 'music-together-'
let activeBackup: Promise<void> | null = null
let backupTimer: ReturnType<typeof setInterval> | null = null

function formatBackupName(): string {
  return `${backupPrefix}${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}`
}

async function copyDataFiles(destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const databaseFileName = path.basename(databasePath)
  const excludedFiles = new Set([databaseFileName, `${databaseFileName}-wal`, `${databaseFileName}-shm`])
  const entries = await readdir(dataDirectory, { withFileTypes: true })

  for (const entry of entries) {
    if (excludedFiles.has(entry.name)) continue
    const source = path.join(dataDirectory, entry.name)
    await cp(source, path.join(destination, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    })
  }
}

async function copyEnvironmentFile(destination: string): Promise<boolean> {
  const environmentFile = path.join(rootDirectory, '.env')
  try {
    if (!(await stat(environmentFile)).isFile()) return false
    await cp(environmentFile, path.join(destination, '.env'), { force: true })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function removeExpiredBackups(): Promise<void> {
  const settings = backupSettingsRepo.get()
  if (!settings.cleanupEnabled) return
  const expiresBefore = Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000
  const entries = await readdir(backupDirectory, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(backupPrefix)) continue
    const backupPath = path.join(backupDirectory, entry.name)
    if ((await stat(backupPath)).mtimeMs < expiresBefore) {
      await rm(backupPath, { recursive: true, force: true })
      logger.info('Removed expired backup', { backupPath })
    }
  }
}

async function createBackup(): Promise<void> {
  await mkdir(backupDirectory, { recursive: true })
  const backupName = formatBackupName()
  const temporaryDirectory = path.join(backupDirectory, `.${backupName}.tmp`)
  const finalDirectory = path.join(backupDirectory, backupName)

  try {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await mkdir(path.join(temporaryDirectory, 'data'), { recursive: true })
    await db.backup(path.join(temporaryDirectory, 'data', path.basename(databasePath)))
    await copyDataFiles(path.join(temporaryDirectory, 'data'))
    const copiedEnvironment = await copyEnvironmentFile(temporaryDirectory)
    if (!copiedEnvironment) logger.warn('Skipped .env backup because the file was not found')

    const manifest = {
      createdAt: new Date().toISOString(),
      database: path.basename(databasePath),
      environmentFileIncluded: copiedEnvironment,
    }
    await writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temporaryDirectory, finalDirectory)
    await removeExpiredBackups()
    logger.info('Backup created', { backupPath: finalDirectory })
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function runBackup(): Promise<void> {
  if (activeBackup) {
    logger.warn('Skipped backup because another backup is still running')
    return activeBackup
  }

  activeBackup = createBackup()
  try {
    await activeBackup
  } catch (error) {
    logger.error('Backup failed', error)
  } finally {
    activeBackup = null
  }
}

function scheduleBackups(): void {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
  const settings = backupSettingsRepo.get()
  if (!settings.enabled) {
    logger.info('Automatic backups are disabled')
    return
  }

  backupTimer = setInterval(() => void runBackup(), settings.intervalHours * 60 * 60 * 1000)
  backupTimer.unref()
  logger.info('Automatic backup scheduler started', {
    backupDirectory,
    intervalHours: settings.intervalHours,
    retentionDays: settings.retentionDays,
    cleanupEnabled: settings.cleanupEnabled,
  })
}

export function startBackupScheduler(): void {
  const settings = backupSettingsRepo.get()
  scheduleBackups()
  if (settings.enabled) void runBackup()
}

export function refreshBackupScheduler(runImmediately = false): void {
  const settings = backupSettingsRepo.get()
  scheduleBackups()
  if (runImmediately && settings.enabled) void runBackup()
}

export function stopBackupScheduler(): void {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
}
