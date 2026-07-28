import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { loginIdentity, logoutIdentity, setInitialPassword, updateAccountId } from '@/lib/identityAuth'
import { useSocketContext } from '@/providers/socket-context'
import { useAccountStore } from '@/stores/accountStore'
import { Check, Copy, KeyRound, Loader2, LogIn, LogOut, Pencil, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

const ACCOUNT_ID_PATTERN = /^[a-z0-9_-]{3,32}$/

export function AccountIdEditor({ compact = false, onComplete }: { compact?: boolean; onComplete?: () => void }) {
  const { socket } = useSocketContext()
  const profile = useAccountStore((state) => state.profile)
  const [editing, setEditing] = useState(!compact)
  const [accountId, setAccountId] = useState(profile?.id ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAccountId(profile?.id ?? '')
  }, [profile?.id])

  const copyAccountId = async () => {
    if (!profile?.id) return
    await navigator.clipboard.writeText(profile.id)
    toast.success('账号 ID 已复制')
  }

  const cancel = () => {
    setAccountId(profile?.id ?? '')
    setCurrentPassword('')
    setEditing(false)
  }

  const save = async () => {
    const normalized = accountId.trim().toLowerCase()
    if (!ACCOUNT_ID_PATTERN.test(normalized) || normalized === profile?.id) return
    setSaving(true)
    try {
      await updateAccountId(socket, normalized, currentPassword || undefined)
      setCurrentPassword('')
      setEditing(!compact)
      toast.success('账号 ID 已修改')
      onComplete?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '账号 ID 修改失败')
    } finally {
      setSaving(false)
    }
  }

  if (compact && !editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-medium text-muted-foreground">账号 ID</span>
          <code className="block truncate text-[11px]">{profile?.id ?? '初始化中'}</code>
        </div>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
          <span className="sr-only">修改账号 ID</span>
        </Button>
      </div>
    )
  }

  const normalized = accountId.trim().toLowerCase()
  const canSave =
    ACCOUNT_ID_PATTERN.test(normalized) &&
    normalized !== profile?.id &&
    (!profile?.hasPassword || currentPassword.length > 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={compact ? 'compact-account-id' : 'account-id'}
          className="text-xs font-medium text-muted-foreground"
        >
          账号 ID
        </label>
        {!compact && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void copyAccountId()}>
            <Copy className="h-3.5 w-3.5" />
            <span className="sr-only">复制账号 ID</span>
          </Button>
        )}
      </div>
      <Input
        id={compact ? 'compact-account-id' : 'account-id'}
        value={accountId}
        onChange={(event) => setAccountId(event.target.value.toLowerCase())}
        placeholder="3-32 位小写字母、数字、_ 或 -"
        maxLength={32}
        className="h-8 font-mono text-xs"
      />
      {profile?.hasPassword && (
        <Input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && canSave && void save()}
          placeholder="当前密码"
          maxLength={128}
          className="h-8"
        />
      )}
      <div className="flex justify-end gap-2">
        {compact && (
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={cancel} disabled={saving}>
            <X className="h-4 w-4" />
            取消
          </Button>
        )}
        <Button type="button" size="sm" className="h-8" onClick={() => void save()} disabled={saving || !canSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          保存 ID
        </Button>
      </div>
    </div>
  )
}

export function AccountAccessControls({ compact = false, onComplete }: { compact?: boolean; onComplete?: () => void }) {
  const { socket } = useSocketContext()
  const profile = useAccountStore((state) => state.profile)
  const [newPassword, setNewPassword] = useState('')
  const [accountId, setAccountId] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      setNewPassword('')
      setLoginPassword('')
      toast.success(success)
      onComplete?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '账号操作失败')
    } finally {
      setBusy(false)
    }
  }

  if (profile?.hasPassword) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="truncate">账号已启用密码</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => logoutIdentity(socket), '已退出账号并切换到访客身份')}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          退出
        </Button>
      </div>
    )
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          保护当前账号
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="设置密码（至少 8 位）"
            minLength={8}
            maxLength={128}
            className="h-8"
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || newPassword.length < 8}
            onClick={() => void run(() => setInitialPassword(newPassword), '账号密码已设置')}
          >
            设置
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LogIn className="h-4 w-4" />
          登录已有账号
        </div>
        <Input
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          placeholder="账号 ID"
          className="h-8 font-mono text-xs"
        />
        <div className="flex gap-2">
          <Input
            type="password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && accountId.trim() && loginPassword) {
                void run(() => loginIdentity(socket, accountId, loginPassword), '账号登录成功')
              }
            }}
            placeholder="密码"
            className="h-8"
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || !accountId.trim() || !loginPassword}
            onClick={() => void run(() => loginIdentity(socket, accountId, loginPassword), '账号登录成功')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '登录'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AccountSection() {
  const profile = useAccountStore((state) => state.profile)

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-2">
        <h3 className="text-base font-semibold">账号</h3>
        <p className="text-sm text-muted-foreground">请先在个人资料中保存昵称，系统随后会生成账号 ID。</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">账号</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {profile?.hasPassword ? '已登录账号' : '当前为访客身份'}
            </p>
          </div>
          {profile?.role === 'admin' && <Badge variant="secondary">服务器管理员</Badge>}
        </div>
        <Separator className="mt-3" />
      </div>

      <AccountIdEditor />

      <AccountAccessControls />
    </div>
  )
}
