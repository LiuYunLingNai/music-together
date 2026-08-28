import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router-dom'
import { Button, Field, Input, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { ApiError, setupApi } from '../lib/api'

type Mode = 'checking' | 'declaration' | 'setup-form' | 'login'

const DECLARATION_ITEMS = [
  {
    title: '权限范围',
    content:
      '管理员账号拥有本服务器的最高管理权限，包括管理全部用户账号与房间、调整音频代理策略、备份策略与全局背景等服务器设置。',
  },
  {
    title: '安全责任',
    content:
      '账号 ID 与密码是登录本平台的唯一凭证，一旦泄露他人即可完全控制本服务器。请设置高强度密码并妥善保管；初始化完成后不可再次重置首个管理员。',
  },
  {
    title: '谨慎操作',
    content: '删除用户账号、解散房间、重置他人密码等操作不可逆，执行前请务必确认目标对象。',
  },
  {
    title: '隐私与合规',
    content:
      '管理过程中可能接触用户昵称、活跃记录等个人信息，仅限用于服务器维护目的，不得外泄或用于其他用途，并遵守所在地区相关法律法规。',
  },
  {
    title: '唯一性',
    content: '仅第一个完成设置的人会成为服务器管理员；此后如需追加管理员，请通过环境变量 SERVER_ADMIN_IDS 配置。',
  },
]

/** 首次进入：服务器尚无管理员时，阅读声明并同意后创建首个管理员账号 */
export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('checking')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setupApi
      .getStatus()
      .then((status) => {
        if (!cancelled) setMode(status.needed ? 'declaration' : 'login')
      })
      .catch(() => {
        if (!cancelled) setMode('login')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] px-4 py-10 dark:bg-[#0b0c10]">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1890ff] to-[#40a9ff] text-white shadow-lg shadow-[#1890ff]/30">
            <Icon icon="mdi:music-note" className="size-7" />
          </span>
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Music Together 管理平台</h1>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {mode === 'checking'
                ? '正在检查服务器状态…'
                : mode === 'login'
                  ? '仅限服务器管理员登录'
                  : '服务器尚未初始化，请先创建管理员账号'}
            </p>
          </div>
        </div>

        {mode === 'checking' && (
          <div className="flex justify-center rounded-2xl border border-zinc-200/60 bg-white p-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-[#15171e] dark:shadow-none">
            <Spinner />
          </div>
        )}
        {mode === 'declaration' && (
          <DeclarationCard agreed={agreed} onAgreedChange={setAgreed} onNext={() => setMode('setup-form')} />
        )}
        {mode === 'setup-form' && <SetupForm onBack={() => setMode('declaration')} onFinished={() => setMode('login')} />}
        {mode === 'login' && <LoginForm />}
      </div>
    </div>
  )
}

function DeclarationCard({
  agreed,
  onAgreedChange,
  onNext,
}: {
  agreed: boolean
  onAgreedChange: (value: boolean) => void
  onNext: () => void
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-[#15171e] dark:shadow-none">
      <h2 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">管理平台使用声明</h2>
      <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">请完整阅读以下内容后继续</p>

      <div className="max-h-72 space-y-4 overflow-y-auto rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-white/[0.04]">
        {DECLARATION_ITEMS.map((item, index) => (
          <div key={item.title}>
            <h3 className="text-xs font-semibold text-[#1890ff] dark:text-[#69b1ff]">
              {index + 1}. {item.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{item.content}</p>
          </div>
        ))}
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => onAgreedChange(event.target.checked)}
          className="mt-0.5 size-4 accent-[#1890ff] dark:accent-[#40a9ff]"
        />
        <span>我已阅读并同意以上声明，自愿承担服务器管理员职责</span>
      </label>

      <Button className="mt-4 w-full" disabled={!agreed} onClick={onNext}>
        同意并继续
      </Button>
    </div>
  )
}

function SetupForm({ onBack, onFinished }: { onBack: () => void; onFinished: () => void }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [accountId, setAccountId] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^[a-z0-9_-]{3,32}$/.test(accountId)) {
      setError('账号 ID 需为 3-32 位小写字母、数字、下划线或连字符')
      return
    }
    if (!nickname.trim()) {
      setError('请输入昵称')
      return
    }
    if (password.length < 8) {
      setError('密码至少需要 8 个字符')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }

    setError(null)
    setLoading(true)
    try {
      await setupApi.setup({ accountId, nickname: nickname.trim(), password, avatarUrl: avatarUrl.trim() || undefined })
      // 服务端已签发身份 Cookie，此处直接复用登录流程载入管理员会话
      const failure = await login(accountId, password)
      if (failure) {
        setError(failure)
        onFinished()
        return
      }
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 初始化已被他人完成，回到登录界面
        onFinished()
        return
      }
      setError(err instanceof Error ? err.message : '初始化失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-[#15171e] dark:shadow-none">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">创建首个管理员账号</h2>
        <button type="button" onClick={onBack} className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
          返回声明
        </button>
      </div>

      <Field label="账号 ID" hint="3-32 位小写字母、数字、下划线或连字符，创建后不可轻易更改">
        <Input
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          placeholder="例如 owner"
          autoComplete="username"
          autoFocus
        />
      </Field>
      <Field label="昵称">
        <Input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="显示给其他用户的名称"
          maxLength={40}
        />
      </Field>
      <Field label="头像（可选）" hint="支持 PNG / JPEG / WebP，不超过 6MB">
        <div className="flex items-center gap-4">
          <label className="flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-zinc-200 bg-zinc-50 transition-colors hover:border-[#1890ff] hover:bg-[#1890ff]/5 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-[#40a9ff] dark:hover:bg-[#40a9ff]/10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="头像预览" className="size-full object-cover" />
            ) : (
              <Icon icon="mdi:camera-outline" className="size-6 text-zinc-400" />
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                if (file.size > 6 * 1024 * 1024) {
                  setError('头像文件不能超过 6MB')
                  return
                }
                const reader = new FileReader()
                reader.onload = () => setAvatarUrl(reader.result as string)
                reader.readAsDataURL(file)
              }}
            />
          </label>
          <div className="flex-1">
            <Input
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="或填写图片链接"
            />
          </div>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl('')}
              className="text-xs text-zinc-400 hover:text-[#ff4d4f] dark:text-zinc-500 dark:hover:text-[#ff7875]"
            >
              清除
            </button>
          )}
        </div>
      </Field>
      <Field label="密码" hint="至少 8 个字符">
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="请输入密码"
          autoComplete="new-password"
        />
      </Field>
      <Field label="确认密码">
        <Input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="请再次输入密码"
          autoComplete="new-password"
        />
      </Field>

      {error && (
        <p className="rounded-lg border border-[#ff4d4f]/20 bg-[#ff4d4f]/[0.06] px-3 py-2 text-xs text-[#ff4d4f] dark:border-[#ff4d4f]/30 dark:bg-[#ff4d4f]/10 dark:text-[#ff7875]">{error}</p>
      )}

      <Button type="submit" loading={loading} className="w-full">
        完成初始化
      </Button>
    </form>
  )
}

function LoginForm() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!accountId.trim() || !password) {
      setError('请输入账号 ID 和密码')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const failure = await login(accountId.trim(), password)
      if (failure) {
        setError(failure)
      } else {
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-[#15171e] dark:shadow-none">
      <Field label="账号 ID">
        <Input
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          placeholder="请输入账号 ID"
          autoComplete="username"
          autoFocus
        />
      </Field>
      <Field label="密码">
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="请输入密码"
          autoComplete="current-password"
        />
      </Field>

      {error && (
        <p className="rounded-lg border border-[#ff4d4f]/20 bg-[#ff4d4f]/[0.06] px-3 py-2 text-xs text-[#ff4d4f] dark:border-[#ff4d4f]/30 dark:bg-[#ff4d4f]/10 dark:text-[#ff7875]">{error}</p>
      )}

      <Button type="submit" loading={loading} className="w-full">
        登录
      </Button>
    </form>
  )
}
