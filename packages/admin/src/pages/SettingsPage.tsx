import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '@iconify/react'
import type { AudioProxyPolicy, BackupSettings } from '@music-together/shared'
import { Badge, Button, Card, ConfirmDialog, Field, Input, PageLoading, SectionCard, Switch } from '../components/ui'
import { useToast } from '../components/toast'
import { adminApi } from '../lib/api'
import type { AdminBackup } from '../lib/types'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <AudioProxyPolicyCard />
      <BackupSettingsCard />
      <BackupFilesCard />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 音频代理策略
// ---------------------------------------------------------------------------

function AudioProxyPolicyCard() {
  const toast = useToast()
  const [policy, setPolicy] = useState<AudioProxyPolicy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    adminApi
      .getAudioProxyPolicy()
      .then((result) => {
        if (!cancelled) setPolicy(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleForceProxy = async (next: boolean) => {
    if (!policy) return
    const previous = policy.kugouForceProxy
    setPolicy({ ...policy, kugouForceProxy: next })
    setSaving(true)
    try {
      const updated = await adminApi.patchAudioProxyPolicy({ kugouForceProxy: next })
      setPolicy(updated)
      toast.show(next ? '已开启酷狗强制代理' : '已关闭酷狗强制代理', 'success')
    } catch (err) {
      setPolicy({ ...policy, kugouForceProxy: previous })
      toast.show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard label="音频代理策略">
      {error && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p>}
      {!error && policy === null && <PageLoading />}
      {policy !== null && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">酷狗强制代理</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              开启后，酷狗音频一律经服务端中转（可解决直连被运营商拦截的问题，但会增加服务器带宽）。
            </p>
          </div>
          <Switch
            checked={policy.kugouForceProxy}
            onChange={toggleForceProxy}
            disabled={saving}
            label="酷狗强制代理"
          />
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// 备份设置
// ---------------------------------------------------------------------------

function BackupSettingsCard() {
  const toast = useToast()
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ intervalHours: '', retentionDays: '' })

  useEffect(() => {
    let cancelled = false
    adminApi
      .getBackupSettings()
      .then((result) => {
        if (cancelled) return
        setSettings(result)
        setDraft({ intervalHours: String(result.intervalHours), retentionDays: String(result.retentionDays) })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async (patch: Partial<BackupSettings>) => {
    if (!settings) return
    const previous = settings
    setSettings({ ...settings, ...patch })
    try {
      const updated = await adminApi.patchBackupSettings(patch)
      setSettings(updated)
      toast.show('备份设置已更新', 'success')
    } catch (err) {
      setSettings(previous)
      toast.show(err instanceof Error ? err.message : '保存失败', 'error')
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!settings) return
    const intervalHours = Number(draft.intervalHours)
    const retentionDays = Number(draft.retentionDays)
    if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24 * 365) {
      toast.show('备份间隔需为 1 - 8760 之间的整数小时', 'error')
      return
    }
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      toast.show('保留天数需为 1 - 3650 之间的整数', 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await adminApi.patchBackupSettings({ intervalHours, retentionDays })
      setSettings(updated)
      toast.show('备份设置已更新', 'success')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard label="自动备份">
      {error && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p>}
      {!error && settings === null && <PageLoading />}
      {settings !== null && (
        <div className="space-y-0">
          <div className="flex items-center justify-between border-b border-zinc-100 py-5 dark:border-zinc-800/60">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">启用自动备份</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">开启后立即执行一次备份，之后按计划周期执行</p>
            </div>
            <Switch checked={settings.enabled} onChange={(next) => toggle({ enabled: next })} label="启用自动备份" />
          </div>

          <div className="flex items-center justify-between border-b border-zinc-100 py-5 dark:border-zinc-800/60">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">自动清理过期备份</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">超过保留天数的备份会被自动删除</p>
            </div>
            <Switch
              checked={settings.cleanupEnabled}
              onChange={(next) => toggle({ cleanupEnabled: next })}
              label="自动清理过期备份"
            />
          </div>

          <form onSubmit={handleSubmit} className="grid max-w-md grid-cols-2 gap-4 pt-6">
            <Field label="备份间隔（小时）" hint="1 - 8760">
              <Input
                type="number"
                min={1}
                max={24 * 365}
                value={draft.intervalHours}
                onChange={(event) => setDraft((prev) => ({ ...prev, intervalHours: event.target.value }))}
              />
            </Field>
            <Field label="保留天数" hint="1 - 3650">
              <Input
                type="number"
                min={1}
                max={3650}
                value={draft.retentionDays}
                onChange={(event) => setDraft((prev) => ({ ...prev, retentionDays: event.target.value }))}
              />
            </Field>
            <div className="col-span-2">
              <Button type="submit" loading={saving}>
                保存数值设置
              </Button>
            </div>
          </form>
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// 备份文件管理（列表 / 立即备份 / 删除）
// ---------------------------------------------------------------------------

function BackupFilesCard() {
  const toast = useToast()
  const [backups, setBackups] = useState<AdminBackup[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runningBackup, setRunningBackup] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminBackup | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    adminApi
      .listBackups()
      .then((result) => {
        setBackups(result.backups)
        setRunning(result.running)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载失败')
      })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRunBackup = async () => {
    setRunningBackup(true)
    try {
      const result = await adminApi.runBackup()
      toast.show(`备份任务已启动：${result.name}`, 'success')
      load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '备份失败', 'error')
    } finally {
      setRunningBackup(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await adminApi.deleteBackup(deleteTarget.name)
      toast.show(`已删除备份 ${deleteTarget.name}`, 'success')
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card
      title="备份文件"
      description="查看、创建与删除服务端备份；删除后不可恢复，请确认已离线保存"
      actions={
        <Button size="sm" onClick={handleRunBackup} loading={runningBackup} disabled={running}>
          <Icon icon="mdi:backup-restore" className="size-3.5" />
          {running ? '备份进行中…' : '立即备份'}
        </Button>
      }
    >
      {error && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p>}
      {!error && backups === null && <PageLoading />}
      {backups !== null && backups.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">暂无备份，点击右上角"立即备份"创建第一个备份</p>
      )}
      {backups !== null && backups.length > 0 && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {backups.map((backup) => (
            <div key={backup.name} className="flex items-center justify-between gap-3 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-700 dark:text-zinc-200">{backup.name}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                  {new Date(backup.createdAt).toLocaleString('zh-CN')}
                  {backup.includesEnvFile && <Badge tone="success">含环境配置</Badge>}
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => setDeleteTarget(backup)}>
                删除
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除备份"
        danger
        confirmText="删除"
        loading={deleting}
        message={
          <p>
            确定删除备份 <span className="font-medium text-zinc-800 dark:text-zinc-100">{deleteTarget?.name}</span> 吗？
            删除后无法恢复，如需长期保存请先下载到本地。
          </p>
        }
        onConfirm={handleDelete}
        onClose={() => !deleting && setDeleteTarget(null)}
      />
    </Card>
  )
}
