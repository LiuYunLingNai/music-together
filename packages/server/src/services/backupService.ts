import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupSettingsRepo } from '../repositories/backupSettingsRepository.js'
import { databasePath, db } from '../repositories/database.js'
import { logger } from '../utils/logger.js'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const dataDirectory = path.dirname(databasePath)
// 支持环境变量覆盖，便于测试与自定义部署位置
const backupDirectory = process.env.MUSIC_TOGETHER_BACKUP_DIR ?? path.join(rootDirectory, 'backups')
const backupPrefix = 'music-together-'
const backupNamePattern = /^music-together-[A-Za-z0-9_-]+$/
let activeBackup: Promise<string> | null = null
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
      logger.info('已清理过期备份', { backupPath })
    }
  }
}

async function createBackup(): Promise<string> {
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
    if (!copiedEnvironment) logger.warn('未找到 .env 文件，已跳过环境配置备份')

    const manifest = {
      createdAt: new Date().toISOString(),
      database: path.basename(databasePath),
      environmentFileIncluded: copiedEnvironment,
    }
    await writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temporaryDirectory, finalDirectory)
    await removeExpiredBackups()
    logger.info('备份已创建', { backupPath: finalDirectory })
    return backupName
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function runBackup(): Promise<void> {
  if (activeBackup) {
    logger.warn('已有备份正在进行，本次备份已跳过')
    await activeBackup
    return
  }

  activeBackup = createBackup()
  try {
    await activeBackup
  } catch (error) {
    logger.error('备份失败', error)
  } finally {
    activeBackup = null
  }
}

// ---------------------------------------------------------------------------
// 管理接口能力：备份文件列表 / 手动备份 / 删除备份 / 下载路径解析
// ---------------------------------------------------------------------------

export interface BackupInfo {
  name: string
  createdAt: string
  includesEnvFile: boolean
}

export function isBackupRunning(): boolean {
  return activeBackup !== null
}

export async function listBackups(): Promise<BackupInfo[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(backupDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const backups: BackupInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(backupPrefix)) continue
    const backupPath = path.join(backupDirectory, entry.name)
    let createdAt = new Date((await stat(backupPath)).mtimeMs).toISOString()
    let includesEnvFile = false
    try {
      const manifest = JSON.parse(await readFile(path.join(backupPath, 'manifest.json'), 'utf8')) as {
        createdAt?: string
        environmentFileIncluded?: boolean
      }
      if (typeof manifest.createdAt === 'string') createdAt = manifest.createdAt
      includesEnvFile = manifest.environmentFileIncluded === true
    } catch {
      // 无清单文件时退回目录修改时间
    }
    backups.push({ name: entry.name, createdAt, includesEnvFile })
  }
  return backups.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 管理员手动触发备份；已有备份进行中时抛出异常由路由层转 409。 */
export async function createManualBackup(): Promise<string> {
  if (activeBackup) throw new Error('A backup is already running')
  activeBackup = createBackup()
  try {
    return await activeBackup
  } finally {
    activeBackup = null
  }
}

/** 删除指定备份目录；返回 false 表示备份不存在。名称必须合法，杜绝路径穿越。 */
export async function deleteBackup(name: string): Promise<boolean> {
  if (!backupNamePattern.test(name)) throw new Error('Invalid backup name')
  const backupPath = path.join(backupDirectory, name)
  try {
    if (!(await stat(backupPath)).isDirectory()) return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  await rm(backupPath, { recursive: true, force: true })
  logger.info('备份已由管理员删除', { backupName: name })
  return true
}

function scheduleBackups(): void {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
  const settings = backupSettingsRepo.get()
  if (!settings.enabled) {
    logger.info('自动备份未启用')
    return
  }

  backupTimer = setInterval(() => void runBackup(), settings.intervalHours * 60 * 60 * 1000)
  backupTimer.unref()
  logger.info('自动备份调度已启动', {
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
