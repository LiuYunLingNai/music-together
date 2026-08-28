import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

// ---------------------------------------------------------------------------
// Button（中圆角，腾讯极客蓝主色）
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[#1890ff] text-white shadow-sm shadow-[#1890ff]/25 hover:bg-[#096dd9] disabled:hover:bg-[#1890ff] ' +
    'dark:bg-[#40a9ff] dark:shadow-none dark:hover:bg-[#69b1ff] dark:disabled:hover:bg-[#40a9ff]',
  ghost:
    'border border-zinc-200 bg-white text-zinc-600 hover:border-[#1890ff]/50 hover:text-[#1890ff] ' +
    'disabled:hover:border-zinc-200 disabled:hover:text-zinc-600 ' +
    'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-[#40a9ff]/60 dark:hover:text-[#40a9ff] ' +
    'dark:disabled:hover:border-zinc-700 dark:disabled:hover:text-zinc-300',
  danger:
    'bg-[#ff4d4f] text-white shadow-sm shadow-[#ff4d4f]/25 hover:bg-[#ff7875] disabled:hover:bg-[#ff4d4f] ' +
    'dark:bg-[#a61d24] dark:shadow-none dark:hover:bg-[#c62b33] dark:disabled:hover:bg-[#a61d24]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' ? 'h-8 px-3.5 text-xs' : 'h-9.5 px-4.5 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Card（16px 圆角 + 发丝边框 + 轻盈阴影）
// ---------------------------------------------------------------------------

const SURFACE =
  'rounded-2xl border border-zinc-200/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] ' +
  'dark:border-zinc-800/80 dark:bg-[#15171e] dark:shadow-none'

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(SURFACE, className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-zinc-100 px-8 py-5 dark:border-zinc-800">
          <div>
            {title && <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>}
            {description && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-8">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SectionCard（分组卡片：顶部灰色小标签 + 内容区）
// 对应参考图中 "基本信息"、"管理员信息" 等分组标题样式
// ---------------------------------------------------------------------------

export function SectionCard({
  label,
  children,
  className,
}: {
  /** 分组标签文字，如 "基本信息"、"管理员信息" */
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(SURFACE, 'p-8', className)}>
      <p className="mb-5 text-xs font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">{label}</p>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ListItem（列表项：左侧标签 + 右侧值 + 右箭头）
// 对应参考图中 "头像 >"、"昵称 米游社小助手 >" 等行布局
// ---------------------------------------------------------------------------

export function ListItem({
  label,
  description,
  value,
  onClick,
  rightSlot,
  noBorder,
  danger,
}: {
  /** 左侧标签文字 */
  label: string
  /** 标签下方的描述文字（可选） */
  description?: string
  /** 右侧显示的值（可选） */
  value?: ReactNode
  /** 点击整行时的回调；传入后右侧自动显示箭头 */
  onClick?: () => void
  /** 自定义右侧插槽（替代默认箭头） */
  rightSlot?: ReactNode
  /** 移除底部分隔线 */
  noBorder?: boolean
  /** 危险操作样式（红色文字） */
  danger?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-4',
        !noBorder && 'border-b border-zinc-100 last:border-0 dark:border-zinc-800/60',
        onClick && 'cursor-pointer transition-colors hover:bg-zinc-50/50 dark:hover:bg-white/[0.02]',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', danger ? 'text-[#ff4d4f] dark:text-[#ff7875]' : 'text-zinc-900 dark:text-zinc-50')}>
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{description}</p>
        )}
      </div>
      {rightSlot !== undefined ? (
        <div className="shrink-0">{rightSlot}</div>
      ) : value !== undefined ? (
        <div className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          {value}
          {onClick && <IconArrow />}
        </div>
      ) : onClick ? (
        <IconArrow />
      ) : null}
    </div>
  )
}

function IconArrow() {
  return (
    <svg
      className="size-4 text-zinc-300 dark:text-zinc-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// StatCard（概览页指标卡：极客蓝系圆形图标 + 数值 + 标签）
// ---------------------------------------------------------------------------

const STAT_TONES = {
  blue: 'bg-[#1890ff]/10 text-[#1890ff] dark:bg-[#40a9ff]/15 dark:text-[#40a9ff]',
  green: 'bg-[#52c41a]/10 text-[#389e0d] dark:bg-[#49aa19]/15 dark:text-[#6abe39]',
  purple: 'bg-[#722ed1]/10 text-[#722ed1] dark:bg-[#9254de]/15 dark:text-[#9254de]',
  amber: 'bg-[#faad14]/12 text-[#d48806] dark:bg-[#d89614]/15 dark:text-[#d89614]',
} as const

export function StatCard({
  icon,
  tone = 'blue',
  label,
  value,
}: {
  icon: ReactNode
  tone?: keyof typeof STAT_TONES
  label: string
  value: ReactNode
}) {
  return (
    <div className={cn('flex items-center justify-between p-7', SURFACE)}>
      <div className="min-w-0">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{label}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
      </div>
      <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full text-xl', STAT_TONES[tone])}>
        {icon}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 表单控件（填充式输入框，聚焦蓝色光环）
// ---------------------------------------------------------------------------

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </label>
  )
}

const CONTROL_BASE =
  'h-9.5 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 ' +
  'placeholder:text-zinc-400 transition-all focus:border-[#1890ff]/60 focus:ring-2 focus:ring-[#1890ff]/15 focus:outline-none ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-[#40a9ff]/70 dark:focus:ring-[#40a9ff]/20'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_BASE, className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL_BASE, className)} {...rest}>
      {children}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-[#1890ff] dark:bg-[#40a9ff]' : 'bg-zinc-300 dark:bg-zinc-600',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-md transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Badge / Spinner / EmptyState
// ---------------------------------------------------------------------------

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-zinc-500/10 text-zinc-600 dark:bg-zinc-500/20 dark:text-zinc-300',
    success: 'bg-[#52c41a]/10 text-[#389e0d] dark:bg-[#49aa19]/15 dark:text-[#6abe39]',
    warning: 'bg-[#faad14]/12 text-[#d48806] dark:bg-[#d89614]/15 dark:text-[#d89614]',
    danger: 'bg-[#ff4d4f]/10 text-[#ff4d4f] dark:bg-[#a61d24]/20 dark:text-[#ff7875]',
  } as const
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-5 animate-spin rounded-full border-2 border-zinc-400/30 border-t-[#1890ff] dark:border-zinc-500/30 dark:border-t-[#40a9ff]',
        className,
      )}
    />
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {description && <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{description}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog（淡遮罩 + 白面板，腾讯控制台风格）
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** 标题下方的次要说明文字 */
  subtitle?: string
  /** md 适合表单类小弹窗；lg/xl 适合详情类内容丰富的弹窗 */
  width?: 'md' | 'lg' | 'xl'
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  const widthClass = width === 'xl' ? 'max-w-3xl' : width === 'lg' ? 'max-w-xl' : 'max-w-md'
  // 通过 Portal 挂到 body：页面容器带路由过渡 transform，会令 fixed 遮罩退化为局部定位
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="dialog-backdrop absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'dialog-panel relative w-full max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200/60 bg-white shadow-2xl dark:border-zinc-800/80 dark:bg-[#15171e]',
          widthClass,
        )}
      >
        <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white/95 px-8 py-5 backdrop-blur dark:border-zinc-800 dark:bg-[#15171e]/95">
          <h3 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h3>
          {subtitle && <p className="mt-1 truncate text-xs text-zinc-400 dark:text-zinc-500">{subtitle}</p>}
        </header>
        <div className="px-8 py-5 text-sm text-zinc-600 dark:text-zinc-300">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-zinc-100 px-8 py-5 dark:border-zinc-800">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 页面级加载态
// ---------------------------------------------------------------------------

export function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner />
    </div>
  )
}

export function usePageState<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, setData, reload: () => setVersion((v) => v + 1), version }
}
