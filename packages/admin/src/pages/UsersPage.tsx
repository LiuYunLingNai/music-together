import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '@iconify/react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageLoading,
} from '../components/ui'
import { useToast } from '../components/toast'
import { adminApi, formatTime } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PLATFORM_LABELS } from '../lib/types'
import type { AdminPlatformAuth, AdminUser } from '../lib/types'

export default function UsersPage() {
  const { me } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // 删除与重置密码弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  // 平台授权弹窗状态（列表已脱敏，不含 cookie）
  const [authTarget, setAuthTarget] = useState<AdminUser | null>(null)
  const [auths, setAuths] = useState<AdminPlatformAuth[] | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AdminPlatformAuth | null>(null)
  const [revoking, setRevoking] = useState(false)

  const reload = () => setReloadKey((key) => key + 1)

  // 首次与每次 reload 拉取列表
  useEffect(() => {
    let cancelled = false
    setUsers(null)
    setError(null)
    adminApi
      .getUsers()
      .then((result) => {
        if (!cancelled) setUsers(result.users)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const filtered = useMemo(() => {
    if (!users) return []
    const lower = keyword.trim().toLowerCase()
    if (!lower) return users
    return users.filter(
      (user) => user.id.toLowerCase().includes(lower) || user.nickname.toLowerCase().includes(lower),
    )
  }, [users, keyword])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await adminApi.deleteUser(deleteTarget.id)
      toast.show(`已删除账号 ${deleteTarget.id}`, 'success')
      setDeleteTarget(null)
      reload()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!resetTarget) return
    if (newPassword.length < 8) {
      toast.show('密码至少需要 8 个字符', 'error')
      return
    }
    setActionLoading(true)
    try {
      await adminApi.resetPassword(resetTarget.id, newPassword)
      toast.show(`已重置 ${resetTarget.id} 的密码`, 'success')
      setResetTarget(null)
      setNewPassword('')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '重置失败', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const openAuths = (user: AdminUser) => {
    setAuthTarget(user)
    setAuths(null)
    setAuthError(null)
    adminApi
      .getPlatformAuths(user.id)
      .then((result) => setAuths(result.auths))
      .catch((err: unknown) => setAuthError(err instanceof Error ? err.message : '加载失败'))
  }

  const closeAuths = () => {
    setAuthTarget(null)
    setAuths(null)
    setAuthError(null)
    setRevokeTarget(null)
  }

  const handleRevoke = async () => {
    if (!authTarget || !revokeTarget) return
    setRevoking(true)
    try {
      await adminApi.revokePlatformAuth(authTarget.id, revokeTarget.platform)
      toast.show(`已解除 ${PLATFORM_LABELS[revokeTarget.platform]} 授权`, 'success')
      setRevokeTarget(null)
      openAuths(authTarget)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '解除失败', 'error')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-4">
        <div className="w-64">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索账号 ID 或昵称"
          />
        </div>
      </div>

      <Card>
        {error && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p>}
        {!error && users === null && <PageLoading />}
        {users !== null && filtered.length === 0 && (
          <EmptyState title="没有匹配的账号" description="调整搜索关键词后重试" />
        )}
        {filtered.length > 0 && (
          <div className="-mx-8 -my-8 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  <th className="px-8 py-4 font-medium">账号</th>
                  <th className="px-4 py-4 font-medium">角色</th>
                  <th className="px-4 py-4 font-medium">密码</th>
                  <th className="px-4 py-4 font-medium">注册时间</th>
                  <th className="px-4 py-4 font-medium">最后活跃</th>
                  <th className="px-8 py-4 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                    <td className="px-8 py-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar url={user.avatarUrl} name={user.nickname || user.id} />
                        <div>
                          <p className="text-zinc-700 dark:text-zinc-200">{user.nickname || '(未设置昵称)'}</p>
                          <p className="text-xs text-zinc-400 dark:text-zinc-500">{user.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {user.role === 'admin' ? (
                        <Badge tone="warning">管理员</Badge>
                      ) : (
                        <Badge>普通用户</Badge>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {user.hasPassword ? (
                        <Badge tone="success">已设置</Badge>
                      ) : (
                        <Badge tone="danger">未设置</Badge>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs text-zinc-400 dark:text-zinc-500">{formatTime(user.createdAt)}</td>
                    <td className="px-4 py-4 text-xs text-zinc-400 dark:text-zinc-500">{formatTime(user.lastSeenAt)}</td>
                    <td className="px-8 py-4">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openAuths(user)}>
                          <Icon icon="mdi:link-variant" className="size-3.5" />
                          平台授权
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetTarget(user)}>
                          <Icon icon="mdi:key-outline" className="size-3.5" />
                          重置密码
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={user.id === me?.id}
                          onClick={() => setDeleteTarget(user)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除账号"
        danger
        confirmText="删除"
        loading={actionLoading}
        message={
          <p>
            确定删除账号 <span className="font-medium text-zinc-800 dark:text-zinc-100">{deleteTarget?.id}</span>
            （{deleteTarget?.nickname || '未设置昵称'}）吗？该操作会同时清除其平台登录凭据，且不可恢复。
          </p>
        }
        onConfirm={handleDelete}
        onClose={() => !actionLoading && setDeleteTarget(null)}
      />

      <Dialog
        open={resetTarget !== null}
        onClose={() => !actionLoading && (setResetTarget(null), setNewPassword(''))}
        title={`重置密码 - ${resetTarget?.id ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setResetTarget(null), setNewPassword(''))} disabled={actionLoading}>
              取消
            </Button>
            <Button type="submit" form="reset-password-form" loading={actionLoading}>
              确认重置
            </Button>
          </>
        }
      >
        <form id="reset-password-form" onSubmit={handleResetPassword} className="space-y-3">
          <Field label="新密码" hint="至少 8 个字符">
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="请输入新密码"
              autoComplete="new-password"
              autoFocus
            />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={authTarget !== null}
        onClose={closeAuths}
        title={`平台授权 - ${authTarget?.nickname || authTarget?.id || ''}`}
        footer={
          <Button variant="ghost" onClick={closeAuths}>
            关闭
          </Button>
        }
      >
        {authError && <p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{authError}</p>}
        {!authError && auths === null && <PageLoading />}
        {auths !== null && auths.length === 0 && (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">该用户尚未绑定任何音乐平台账号</p>
        )}
        {auths !== null && auths.length > 0 && (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {auths.map((auth) => (
              <li key={auth.platform} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {auth.avatarUrl ? (
                    <img src={auth.avatarUrl} alt={auth.nickname} className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1890ff]/10 text-sm font-medium text-[#1890ff] dark:bg-[#40a9ff]/15 dark:text-[#69b1ff] flex-shrink-0">
                      {auth.nickname.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                      {PLATFORM_LABELS[auth.platform] ?? auth.platform}
                      {auth.vipType > 0 && (
                        <Badge tone="warning">{auth.vipLabel ?? 'VIP'}{auth.vipLevel ? ` · Lv${auth.vipLevel}` : ''}</Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                      昵称：{auth.nickname}
                      {auth.credentialRefreshAttemptedAt ? ` · 凭据刷新于 ${formatTime(auth.credentialRefreshAttemptedAt)}` : ''}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="danger" onClick={() => setRevokeTarget(auth)}>
                  解除
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">出于安全，平台登录凭据不会展示；解除后用户需重新登录该平台。</p>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="解除平台授权"
        danger
        confirmText="解除"
        loading={revoking}
        message={
          <p>
            确定解除 <span className="font-medium text-zinc-800 dark:text-zinc-100">{authTarget?.nickname || authTarget?.id}</span> 的
            {revokeTarget ? PLATFORM_LABELS[revokeTarget.platform] : ''}授权吗？该用户的会员音质能力将失效，需重新登录恢复。
          </p>
        }
        onConfirm={handleRevoke}
        onClose={() => !revoking && setRevokeTarget(null)}
      />
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return <img src={url} alt={name} className="size-8 rounded-full object-cover" />
  }
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-[#1890ff]/10 text-xs font-medium text-[#1890ff] dark:bg-[#40a9ff]/15 dark:text-[#69b1ff]">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
