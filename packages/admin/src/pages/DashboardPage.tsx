import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { Card, PageLoading, SectionCard, StatCard } from '../components/ui'
import { adminApi, formatTime } from '../lib/api'
import type { AdminOverview } from '../lib/types'

export default function DashboardPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adminApi
      .getOverview()
      .then((result) => {
        if (!cancelled) setOverview(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <Card title="概览"><p className="text-sm text-[#ff4d4f] dark:text-[#ff7875]">{error}</p></Card>
  }
  if (!overview) return <PageLoading />

  const totalRoomUsers = overview.rooms.reduce((sum, room) => sum + room.userCount, 0)
  const recentUsers = [...overview.users].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 5)

  return (
    <div className="space-y-6">
      {/* 指标卡片 */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard tone="green" icon={<Icon icon="mdi:account-group-outline" />} label="注册用户" value={overview.users.length} />
        <StatCard tone="blue" icon={<Icon icon="mdi:music-box-multiple-outline" />} label="活跃房间" value={overview.rooms.length} />
        <StatCard tone="purple" icon={<Icon icon="mdi:account-music-outline" />} label="房间内总人数" value={totalRoomUsers} />
      </div>

      {/* 系统概览 */}
      <SectionCard label="系统概览">
        <div className="grid gap-x-12 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <InfoItem label="运行状态">
            {overview.healthy ? (
              <span className="flex items-center gap-1.5 font-medium text-[#389e0d] dark:text-[#6abe39]">
                <span className="size-1.5 rounded-full bg-[#52c41a]" />
                运行正常
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-[#ff4d4f] dark:text-[#ff7875]">
                <span className="size-1.5 rounded-full bg-[#ff4d4f]" />
                异常或不可达
              </span>
            )}
          </InfoItem>
          <InfoItem label="服务版本">{overview.version}</InfoItem>
          <InfoItem label="最近活跃用户数">{recentUsers.length}</InfoItem>
        </div>
      </SectionCard>

      {/* 最近活跃用户 */}
      <SectionCard label="最近活跃用户">
        {recentUsers.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">暂无用户</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {recentUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-4 py-4">
                <span className="flex items-center gap-2.5">
                  <Avatar url={user.avatarUrl} name={user.nickname || user.id} />
                  <span className="text-sm text-zinc-700 dark:text-zinc-200">{user.nickname || '(未设置昵称)'}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">{user.id}</span>
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatTime(user.lastSeenAt)}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 活跃房间 */}
      <SectionCard label="活跃房间">
        {overview.rooms.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">当前没有活跃房间</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {overview.rooms.slice(0, 5).map((room) => (
              <div key={room.id} className="flex items-center justify-between gap-4 py-4">
                <span className="text-sm text-zinc-700 dark:text-zinc-200">
                  {room.name}
                  <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{room.id}</span>
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{room.userCount} 人</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{label}</p>
      <div className="mt-1.5 text-zinc-700 dark:text-zinc-200">{children}</div>
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return <img src={url} alt={name} className="size-7 rounded-full object-cover" />
  }
  return (
    <span className="flex size-7 items-center justify-center rounded-full bg-[#1890ff]/10 text-xs font-medium text-[#1890ff] dark:bg-[#40a9ff]/15 dark:text-[#69b1ff]">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
