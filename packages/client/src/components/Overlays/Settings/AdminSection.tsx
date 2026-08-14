import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSocketEvent } from '@/hooks/useSocketEvent'
import { requestJson } from '@/lib/identityAuth'
import { useAccountStore } from '@/stores/accountStore'
import { SERVER_URL } from '@/lib/config'
import { EVENTS, type AudioProxyPolicy, type BackupSettings, type ColorPreset, type GlobalBackgroundSettings } from '@music-together/shared'
import { Archive, DoorClosed, ImagePlus, Link2, Loader2, Network, RefreshCw, Trash2, Upload, Users, X } from 'lucide-react'
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
  const [backupSettings, setBackupSettings] = useState<BackupSettings>({
    enabled: false,
    cleanupEnabled: true,
    intervalHours: 24,
    retentionDays: 7,
  })
  const [globalBackground, setGlobalBackground] = useState<GlobalBackgroundSettings>({
    backgroundUrl: null,
    glassOverlay: false,
    colorPreset: 'gold',
    backgroundBrightness: 60,
    autoTint: false,
    coverAutoTint: false,
  })
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [updatingProxyPolicy, setUpdatingProxyPolicy] = useState(false)
  const [updatingBackupSettings, setUpdatingBackupSettings] = useState(false)
  const [updatingBackground, setUpdatingBackground] = useState(false)
  const [backgroundUrlInput, setBackgroundUrlInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [userData, roomData, proxyPolicy, background, backups] = await Promise.all([
        requestJson<{ users: AdminUser[] }>('/api/admin/users'),
        requestJson<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
        requestJson<AudioProxyPolicy>('/api/admin/audio-proxy-policy'),
        requestJson<GlobalBackgroundSettings>('/api/admin/background'),
        requestJson<BackupSettings>('/api/admin/backup-settings'),
      ])
      setUsers(userData.users)
      setRooms(roomData.rooms)
      setAudioProxyPolicy(proxyPolicy)
      setGlobalBackground(background)
      setBackupSettings(backups)
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

  const updateBackupSettings = async (patch: Partial<BackupSettings>) => {
    setUpdatingBackupSettings(true)
    try {
      const settings = await requestJson<BackupSettings>('/api/admin/backup-settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      setBackupSettings(settings)
      toast.success('备份设置已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '备份设置更新失败')
      await load()
    } finally {
      setUpdatingBackupSettings(false)
    }
  }

  const uploadBackground = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('仅支持 PNG、JPEG 和 WebP 图片')
      return
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error('背景图片不能超过 6MB')
      return
    }

    setUpdatingBackground(true)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
      })
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'POST',
        body: JSON.stringify({ image }),
      })
      setGlobalBackground(settings)
      toast.success('全局背景已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '背景上传失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const removeBackground = async () => {
    if (!window.confirm('确定移除全局背景吗？')) return
    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', { method: 'DELETE' })
      setGlobalBackground(settings)
      toast.success('全局背景已移除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '背景移除失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const updateGlassOverlay = async (glassOverlay: boolean) => {
    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'PATCH',
        body: JSON.stringify({ glassOverlay }),
      })
      setGlobalBackground(settings)
      toast.success(glassOverlay ? '毛玻璃遮罩已开启' : '毛玻璃遮罩已关闭')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '毛玻璃设置更新失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const updateColorPreset = async (colorPreset: ColorPreset) => {
    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'PATCH',
        body: JSON.stringify({ colorPreset }),
      })
      setGlobalBackground(settings)
      toast.success('全局配色已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '全局配色更新失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const updateBackgroundBrightness = async (backgroundBrightness: number) => {
    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'PATCH',
        body: JSON.stringify({ backgroundBrightness }),
      })
      setGlobalBackground(settings)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '背景亮度更新失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const updateAutoTint = async (autoTint: boolean) => {
    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'PATCH',
        body: JSON.stringify({ autoTint }),
      })
      setGlobalBackground(settings)
      toast.success(autoTint ? '自动适配背景色调已开启' : '自动适配背景色调已关闭')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '自动色调设置更新失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const updateCoverAutoTint = async (coverAutoTint: boolean) => {
    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'PATCH',
        body: JSON.stringify({ coverAutoTint }),
      })
      setGlobalBackground(settings)
      toast.success(coverAutoTint ? '跟随歌曲封面色调已开启' : '跟随歌曲封面色调已关闭')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '封面色调设置更新失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const applyBackgroundUrl = async () => {
    const imageUrl = backgroundUrlInput.trim()
    if (!imageUrl) return
    try {
      const parsedUrl = new URL(imageUrl)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('图片 URL 必须使用 HTTP 或 HTTPS')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片 URL 格式无效')
      return
    }

    setUpdatingBackground(true)
    try {
      const settings = await requestJson<GlobalBackgroundSettings>('/api/admin/background', {
        method: 'POST',
        body: JSON.stringify({ imageUrl }),
      })
      setGlobalBackground(settings)
      setBackgroundUrlInput('')
      toast.success('全局背景已从 URL 更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片 URL 获取失败')
    } finally {
      setUpdatingBackground(false)
    }
  }

  const backgroundPreview = globalBackground.backgroundUrl
    ? globalBackground.backgroundUrl.startsWith('/uploads/')
      ? `${SERVER_URL}${globalBackground.backgroundUrl}`
      : globalBackground.backgroundUrl
    : null

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
      <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="users">
            <Users />
            账号
          </TabsTrigger>
          <TabsTrigger value="rooms">
            <DoorClosed />
            房间
          </TabsTrigger>
          <TabsTrigger value="background">
            <ImagePlus />
            背景
          </TabsTrigger>
          <TabsTrigger value="proxy">
            <Network />
            代理
          </TabsTrigger>
          <TabsTrigger value="backup">
            <Archive />
            备份
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

        <TabsContent value="background" className="rounded-md border p-3">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-md border bg-muted/40">
                {backgroundPreview ? (
                  <img src={backgroundPreview} alt="当前全局背景" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-xs">未设置全局背景</span>
                  </div>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                所有首页和房间页使用同一张背景图。上传后会压缩为 WebP 并保存到服务器数据目录。
              </p>
              <div className="flex gap-2">
                <label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={updatingBackground}
                    onChange={(event) => {
                      void uploadBackground(event.currentTarget.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                  <Button asChild type="button" size="sm" disabled={updatingBackground}>
                    <span>
                      {updatingBackground ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      上传背景
                    </span>
                  </Button>
                </label>
                {backgroundPreview && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updatingBackground}
                    onClick={() => void removeBackground()}
                  >
                    <X className="h-4 w-4" />
                    移除
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div>
                  <p className="text-sm font-medium">颜色预设</p>
                  <p className="text-xs text-muted-foreground">与背景搭配的全站强调色</p>
                </div>
                <Select
                  value={globalBackground.colorPreset}
                  disabled={updatingBackground}
                  onValueChange={(value) => void updateColorPreset(value as ColorPreset)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold">金色暖调</SelectItem>
                    <SelectItem value="ocean">海洋青绿</SelectItem>
                    <SelectItem value="rose">玫瑰粉</SelectItem>
                    <SelectItem value="violet">夜幕紫</SelectItem>
                    <SelectItem value="sunset">落日橙红</SelectItem>
                    <SelectItem value="mint">薄荷青柠</SelectItem>
                    <SelectItem value="mono">黑白银灰</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <Switch
                  checked={globalBackground.glassOverlay}
                  disabled={updatingBackground}
                  onCheckedChange={(checked) => void updateGlassOverlay(checked)}
                  aria-label="毛玻璃遮罩"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">毛玻璃遮罩</p>
                  <p className="text-xs text-muted-foreground">让背景更柔和，减少对页面内容的干扰</p>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">背景亮度</p>
                    <p className="text-xs text-muted-foreground">只调整背景图片，不影响文字和卡片</p>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {globalBackground.backgroundBrightness}%
                  </span>
                </div>
                <Slider
                  value={[globalBackground.backgroundBrightness]}
                  min={20}
                  max={100}
                  step={1}
                  disabled={updatingBackground}
                  onValueChange={([value]) => {
                    if (typeof value === 'number') {
                      setGlobalBackground((current) => ({ ...current, backgroundBrightness: value }))
                    }
                  }}
                  onValueCommit={([value]) => {
                    if (typeof value === 'number') void updateBackgroundBrightness(value)
                  }}
                  aria-label="背景亮度"
                />
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <Switch
                  checked={globalBackground.autoTint}
                  disabled={updatingBackground || !backgroundPreview}
                  onCheckedChange={(checked) => void updateAutoTint(checked)}
                  aria-label="自动适配背景色调"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">自动适配背景色调</p>
                  <p className="text-xs text-muted-foreground">从背景图片提取平均色，叠加到背景光效中</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <Switch
                  checked={globalBackground.coverAutoTint}
                  disabled={updatingBackground}
                  onCheckedChange={(checked) => void updateCoverAutoTint(checked)}
                  aria-label="跟随歌曲封面色调"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">跟随歌曲封面色调</p>
                  <p className="text-xs text-muted-foreground">根据当前播放歌曲封面实时更新全局主题色；开启后会关闭背景图自动适配。</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={backgroundUrlInput}
                  onChange={(event) => setBackgroundUrlInput(event.target.value)}
                  placeholder="图片 API / 图片 URL（返回图片文件）"
                  disabled={updatingBackground}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void applyBackgroundUrl()
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatingBackground || !backgroundUrlInput.trim()}
                  onClick={() => void applyBackgroundUrl()}
                >
                  {updatingBackground ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  使用 URL
                </Button>
              </div>
            </div>
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

        <TabsContent value="backup" className="rounded-md border">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="divide-y px-3">
              <SettingRow label="自动备份" description="服务器启动后立即备份，随后按设定间隔继续执行。">
                <Switch
                  checked={backupSettings.enabled}
                  disabled={updatingBackupSettings}
                  onCheckedChange={(enabled) => void updateBackupSettings({ enabled })}
                  aria-label="自动备份"
                />
              </SettingRow>
              <SettingRow label="备份间隔" description="每隔多少小时创建一次备份。">
                <Input
                  type="number"
                  min={1}
                  max={24 * 365}
                  className="h-8 w-24 text-right tabular-nums"
                  value={backupSettings.intervalHours}
                  disabled={updatingBackupSettings}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber
                    if (Number.isFinite(value)) {
                      setBackupSettings((current) => ({ ...current, intervalHours: Math.min(24 * 365, Math.max(1, value)) }))
                    }
                  }}
                  onBlur={() => void updateBackupSettings({ intervalHours: backupSettings.intervalHours })}
                  aria-label="备份间隔（小时）"
                />
              </SettingRow>
              <SettingRow label="保留天数" description="超过此天数的备份会自动删除。">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  className="h-8 w-24 text-right tabular-nums"
                  value={backupSettings.retentionDays}
                  disabled={updatingBackupSettings}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber
                    if (Number.isFinite(value)) {
                      setBackupSettings((current) => ({ ...current, retentionDays: Math.min(3650, Math.max(1, value)) }))
                    }
                  }}
                  onBlur={() => void updateBackupSettings({ retentionDays: backupSettings.retentionDays })}
                  aria-label="备份保留天数"
                />
              </SettingRow>
              <SettingRow label="定期清理备份" description="关闭后仍会创建备份，但不会自动删除旧备份。">
                <Switch
                  checked={backupSettings.cleanupEnabled}
                  disabled={updatingBackupSettings}
                  onCheckedChange={(cleanupEnabled) => void updateBackupSettings({ cleanupEnabled })}
                  aria-label="定期清理备份"
                />
              </SettingRow>
              <p className="py-3 text-xs leading-relaxed text-muted-foreground">
                备份保存到服务器项目根目录的 backups 文件夹，包含 .env、数据库快照和附件文件。
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
