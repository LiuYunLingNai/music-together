import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSocketEvent } from '@/hooks/useSocketEvent'
import { requestJson } from '@/lib/identityAuth'
import { useAccountStore } from '@/stores/accountStore'
import { EVENTS, type AudioProxyPolicy } from '@music-together/shared'
import { DoorClosed, Loader2, Network, RefreshCw, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SettingRow } from './SettingRow'

interface AdminUser {
  id: string
  nickname: string
  avatarUrl: string | null
  role: 'user' | 'admin'
  hasPassword: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

interface AdminRoom {
  id: string
  name: string
  creatorId: string
  userCount: number
  hasPassword: boolean
  hidden: boolean
  permanent: boolean
  currentTrackTitle: string | null
}

export function AdminSection() {
  const currentUserId = useAccountStore((state) => state.profile?.id)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [audioProxyPolicy, setAudioProxyPolicy] = useState<AudioProxyPolicy>({
    kugouForceProxy: true,
  })
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [updatingProxyPolicy, setUpdatingProxyPolicy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [userData, roomData, proxyPolicy] = await Promise.all([
        requestJson<{ users: AdminUser[] }>('/api/admin/users'),
        requestJson<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
        requestJson<AudioProxyPolicy>('/api/admin/audio-proxy-policy'),
      ])
      setUsers(userData.users)
      setRooms(roomData.rooms)
      setAudioProxyPolicy(proxyPolicy)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '管理员数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useSocketEvent(EVENTS.SERVER_AUDIO_PROXY_POLICY, setAudioProxyPolicy)

  const updateAudioProxyPolicy = async (checked: boolean) => {
    setUpdatingProxyPolicy(true)
    try {
      const policy = await requestJson<AudioProxyPolicy>('/api/admin/audio-proxy-policy', {
        method: 'PATCH',
        body: JSON.stringify({ kugouForceProxy: checked }),
      })
      setAudioProxyPolicy(policy)
      toast.success('音频代理策略已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '音频代理策略更新失败')
    } finally {
      setUpdatingProxyPolicy(false)
    }
  }

  const deleteUser = async (user: AdminUser) => {
    if (!window.confirm(`确定删除账号 ${user.id}？`)) return
    setWorkingId(user.id)
    try {
      await requestJson<void>(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      toast.success('账号已删除')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setWorkingId(null)
    }
  }

  const resetPassword = async (user: AdminUser) => {
    const password = passwords[user.id] ?? ''
    if (password.length < 8) return
    setWorkingId(user.id)
    try {
      await requestJson<void>(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setPasswords((current) => ({ ...current, [user.id]: '' }))
      toast.success('密码已重置')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '密码重置失败')
    } finally {
      setWorkingId(null)
    }
  }

  const dissolveRoom = async (room: AdminRoom) => {
    if (!window.confirm(`确定解散房间 ${room.name}（${room.id}）？`)) return
    setWorkingId(room.id)
    try {
      await requestJson<void>(`/api/admin/rooms/${encodeURIComponent(room.id)}/dissolve`, { method: 'POST' })
      toast.success('房间已解散')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '解散房间失败')
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">服务器管理</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            账号 {users.length} · 活跃房间 {rooms.length}
          </p>
        </div>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => void load()}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          <span className="sr-only">刷新</span>
        </Button>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="w-full">
          <TabsTrigger value="users">
            <Users />
            账号
          </TabsTrigger>
          <TabsTrigger value="rooms">
            <DoorClosed />
            房间
          </TabsTrigger>
          <TabsTrigger value="proxy">
            <Network />
            代理
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-0 divide-y rounded-md border">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">暂无账号</p>
          ) : (
            users.map((user) => (
              <div key={user.id} className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{user.nickname || '未设置昵称'}</span>
                      {user.role === 'admin' && <Badge variant="secondary">管理员</Badge>}
                      {user.hasPassword && <Badge variant="outline">有密码</Badge>}
                    </div>
                    <code className="block truncate text-[11px] text-muted-foreground">{user.id}</code>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    disabled={workingId === user.id || currentUserId === user.id}
                    onClick={() => void deleteUser(user)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">删除账号</span>
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={passwords[user.id] ?? ''}
                    onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                    placeholder="新密码（至少 8 位）"
                    className="h-8"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={workingId === user.id || (passwords[user.id]?.length ?? 0) < 8}
                    onClick={() => void resetPassword(user)}
                  >
                    重置密码
                  </Button>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="rooms" className="space-y-0 divide-y rounded-md border">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rooms.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">暂无活跃房间</p>
          ) : (
            rooms.map((room) => (
              <div key={room.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{room.name}</span>
                    <Badge variant="outline">{room.userCount} 人</Badge>
                    {room.hasPassword && <Badge variant="secondary">密码</Badge>}
                    <Badge variant={room.hidden ? 'secondary' : 'outline'}>{room.hidden ? '隐藏' : '公开'}</Badge>
                    <Badge variant={room.permanent ? 'secondary' : 'outline'}>{room.permanent ? '永久' : '临时'}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {room.id}
                    {room.currentTrackTitle ? ` · ${room.currentTrackTitle}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={workingId === room.id}
                  onClick={() => void dissolveRoom(room)}
                >
                  解散
                </Button>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="proxy" className="rounded-md border">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="border-b bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                B 站始终通过服务器代理播放，Cookie 仅保留在服务端。酷狗开关仅影响原生客户端；Web 端始终使用服务器代理。
              </div>
              <div className="divide-y px-3">
                <SettingRow
                  label="酷狗强制服务器代理"
                  description="同时控制标准版和概念版；关闭后明文资源优先直连，加密资源仍由服务器代理解密"
                >
                  <Switch
                    checked={audioProxyPolicy.kugouForceProxy}
                    disabled={updatingProxyPolicy}
                    onCheckedChange={(checked) => void updateAudioProxyPolicy(checked)}
                    aria-label="酷狗强制服务器代理"
                  />
                </SettingRow>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
