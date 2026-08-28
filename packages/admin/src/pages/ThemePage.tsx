import { Icon } from '@iconify/react'
import { SectionCard } from '../components/ui'
import { cn } from '../lib/cn'
import { useTheme, type ThemeMode } from '../lib/theme'

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; description: string; icon: string }> = [
  { value: 'light', label: '浅色', description: '明亮的浅色界面，默认主题', icon: 'mdi:white-balance-sunny' },
  { value: 'dark', label: '深色', description: '低亮度深色界面，适合夜间使用', icon: 'mdi:weather-night' },
  { value: 'system', label: '跟随系统', description: '随操作系统的浅色/深色偏好自动切换', icon: 'mdi:theme-light-dark' },
]

/** 主题设置：浅色 / 深色 / 跟随系统，选择立即生效并持久化到浏览器本地 */
export default function ThemePage() {
  const { mode, setMode } = useTheme()

  return (
    <div className="space-y-6">
      <SectionCard label="界面主题">
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => {
            const active = option.value === mode
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-[#1890ff]/40 bg-[#e6f4ff] dark:border-[#40a9ff]/50 dark:bg-[#40a9ff]/10'
                    : 'border-zinc-200/70 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-[#15171e] dark:hover:bg-white/[0.03]',
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <Icon
                    icon={option.icon}
                    className={cn('size-5', active ? 'text-[#1890ff] dark:text-[#69b1ff]' : 'text-zinc-400 dark:text-zinc-500')}
                  />
                  {active && <Icon icon="mdi:check-circle" className="size-4.5 text-[#1890ff] dark:text-[#69b1ff]" />}
                </span>
                <span>
                  <span className={cn('block text-sm font-medium', active ? 'text-[#1890ff] dark:text-[#69b1ff]' : 'text-zinc-700 dark:text-zinc-200')}>
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">{option.description}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">选择立即生效，并保存在本浏览器中</p>
      </SectionCard>

      <SectionCard label="动效说明">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          页面切换与交互动画在系统开启"减少动态效果"（prefers-reduced-motion）时会自动禁用，仅保留必要的状态变化。
        </p>
      </SectionCard>
    </div>
  )
}
