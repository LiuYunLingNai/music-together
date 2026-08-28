import { Icon } from '@iconify/react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { cn } from '../lib/cn'

const NAV_ITEMS = [
  { to: '/', label: '概览', icon: 'mdi:view-dashboard-outline', end: true },
  { to: '/users', label: '用户管理', icon: 'mdi:account-group-outline' },
  { to: '/rooms', label: '房间管理', icon: 'mdi:music-box-multiple-outline' },
  { to: '/settings', label: '系统设置', icon: 'mdi:cog-outline' },
  { to: '/background', label: '全局背景', icon: 'mdi:image-outline' },
  { to: '/docs', label: '接口文档', icon: 'mdi:book-open-variant-outline' },
  { to: '/theme', label: '主题设置', icon: 'mdi:palette-outline' },
]

export default function Layout() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const activeItem = NAV_ITEMS.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  )

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen gap-5 bg-[#f0f2f5] p-5 text-zinc-800 dark:bg-[#0b0c10] dark:text-zinc-200">
      {/* 左侧悬浮圆角导航面板 */}
      <aside className="sticky top-5 flex h-[calc(100vh-2.5rem)] w-48 shrink-0 flex-col rounded-2xl border border-zinc-200/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-[#15171e]">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1890ff] to-[#40a9ff] text-white shadow-sm shadow-[#1890ff]/30">
            <Icon icon="mdi:music-note" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Music Together</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">管理平台</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] transition-all',
                  isActive
                    ? 'bg-[#e6f7ff] font-semibold text-[#1890ff] dark:bg-[#40a9ff]/12 dark:text-[#69b1ff]'
                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200',
                )
              }
            >
              <Icon icon={item.icon} className="size-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            {me?.avatarUrl ? (
              <img src={me.avatarUrl} alt="" className="size-7 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1890ff]/10 text-xs font-medium text-[#1890ff] dark:bg-[#40a9ff]/15 dark:text-[#69b1ff]">
                {(me?.nickname || '管')[0]}
              </span>
            )}
            <p className="truncate text-xs text-zinc-600 dark:text-zinc-300">{me ? me.nickname || me.id : ''}</p>
          </div>
          <button
            onClick={handleLogout}
            className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-[#ff4d4f] dark:text-zinc-500 dark:hover:text-[#ff7875]"
          >
            <Icon icon="mdi:logout" className="size-3.5" />
            退出登录
          </button>
        </div>
      </aside>

      {/* 右侧主内容区 */}
      <main className="min-w-0 flex-1 space-y-5">
        <div key={location.pathname} className="page-transition">
          <header className="mb-8 flex items-center gap-3">
            {activeItem && (
              <Icon icon={activeItem.icon} className="size-6 text-[#1890ff] dark:text-[#40a9ff]" />
            )}
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {activeItem?.label ?? 'Music Together'}
            </h1>
          </header>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
