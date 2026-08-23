import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { storage } from '@/lib/storage'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useAccountStore } from '@/stores/accountStore'
import type { AudioQuality, NeteaseRoamingMode, RoamingSource } from '@music-together/shared'
import { LIMITS } from '@music-together/shared'
import { Check, Copy, Lock, LockOpen, Pencil, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SettingRow } from './SettingRow'
import { getAudioQualityLabel, getAudioQualityOptions } from '@/lib/audioQuality'
import { updateCurrentNickname } from '@/lib/profileApi'
import { useAuth } from '@/hooks/useAuth'

const ROAMING_MODE_OPTIONS: { value: NeteaseRoamingMode; label: string; description: string }[] = [
  { value: 'DEFAULT', label: '默认漫游', description: '综合听歌记录，常规个性化推荐' },
  { value: 'FAMILIAR', label: '熟悉模式', description: '多推收藏、常听与相似曲风' },
  { value: 'EXPLORE', label: '探索模式', description: '多推新歌、冷门歌，拓展曲库' },
  { value: 'SCENE_RCMD:EXERCISE', label: '运动场景', description: '节奏明快，适合锻炼' },
  { value: 'SCENE_RCMD:FOCUS', label: '专注场景', description: '适合工作、学习，偏轻音乐' },
  { value: 'SCENE_RCMD:NIGHT_EMO', label: '深夜场景', description: '夜晚情绪向慢歌' },
  { value: 'aidj', label: 'AI DJ', description: 'AI 串烧混剪，曲间带过渡衔接' },
]

const ROAMING_SOURCE_LABELS: Record<RoamingSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
}

interface RoomSettingsSectionProps {
  onUpdateSettings: (settings: {
    name?: string
    password?: string | null
    audioQuality?: AudioQuality
    hidden?: boolean
    permanent?: boolean
    allowTemporaryAdminTrackRemoval?: boolean
    allowTemporaryAdminQueueClear?: boolean
    removePlayedTracks?: boolean
    roamingEnabled?: boolean
    roamingSource?: RoamingSource
    roamingMode?: NeteaseRoamingMode
  }) => void
}

export function RoomSettingsSection({ onUpdateSettings }: RoomSettingsSectionProps) {
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const roomPassword = useRoomStore((s) => s.roomPassword)
  const syncDrift = usePlayerStore((s) => s.syncDrift)
  const isServerAdmin = useAccountStore((state) => state.profile?.role === 'admin')
  const isOwner = currentUser?.role === 'owner' || isServerAdmin
  const canAdjustAudioQuality = isOwner || currentUser?.role === 'admin'
  const { platformStatus, myStatus, statusLoaded } = useAuth()
  const qualityOptions = useMemo(() => getAudioQualityOptions(platformStatus), [platformStatus])
  const roamingSource = room?.roamingSource ?? 'netease'
  const roamingMode = room?.roamingMode ?? 'DEFAULT'
  const roamingModeOption = ROAMING_MODE_OPTIONS.find((option) => option.value === roamingMode) ?? ROAMING_MODE_OPTIONS[0]
  const creatorIsCurrentUser = currentUser?.id === room?.creatorId
  const creatorLoggedInToRoamingSource =
    creatorIsCurrentUser && myStatus.some((status) => status.platform === roamingSource && status.loggedIn)

  const driftDisplay = useMemo(() => {
    const ms = Math.round(syncDrift * 1000)
    const label = ms > 0 ? `+${ms}ms` : `${ms}ms`
    const isHigh = Math.abs(ms) > 500
    return { label, isHigh }
  }, [syncDrift])
  const hasPassword = room?.hasPassword ?? false
  const [passwordDraft, setPasswordDraft] = useState({ hasPassword, enabled: hasPassword, input: '' })
  const currentPasswordDraft =
    passwordDraft.hasPassword === hasPassword ? passwordDraft : { hasPassword, enabled: hasPassword, input: '' }
  const passwordInput = currentPasswordDraft.input
  const passwordEnabled = currentPasswordDraft.enabled
  const updatePasswordDraft = (update: Partial<Omit<typeof currentPasswordDraft, 'hasPassword'>>) => {
    setPasswordDraft({ ...currentPasswordDraft, ...update })
  }

  // 昵称编辑
  const [nickname, setNickname] = useState(storage.getNickname())
  const handleNicknameBlur = async () => {
    const trimmed = nickname.trim()
    if (trimmed) {
      try {
        await updateCurrentNickname(trimmed)
        toast.success('昵称已保存到服务器')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '昵称保存失败')
      }
    }
  }

  // Room name editing state
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const copyRoomLink = () => {
    const url = `${window.location.origin}/room/${room?.id}`
    navigator.clipboard.writeText(url)
    toast.success('房间链接已复制')
  }

  const handlePasswordToggle = (checked: boolean) => {
    if (!checked) {
      updatePasswordDraft({ enabled: false, input: '' })
      onUpdateSettings({ password: null })
      toast.success('密码已移除')
    } else {
      updatePasswordDraft({ enabled: true })
    }
  }

  const handleSetPassword = () => {
    if (!passwordInput.trim()) {
      toast.error('请输入密码')
      return
    }
    onUpdateSettings({ password: passwordInput.trim() })
    updatePasswordDraft({ input: '' })
    toast.success('密码已设置')
  }

  const handleStartEditName = () => {
    setNameInput(room?.name ?? '')
    setEditingName(true)
  }

  const handleSaveName = () => {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      toast.error('房间名不能为空')
      return
    }
    if (trimmed === room?.name) {
      setEditingName(false)
      return
    }
    onUpdateSettings({ name: trimmed })
    setEditingName(false)
    toast.success('房间名已更新')
  }

  const handleCancelEditName = () => {
    setEditingName(false)
    setNameInput('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">房间信息</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="房间名">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={LIMITS.ROOM_NAME_MAX_LENGTH}
                className="h-7 w-40 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') handleCancelEditName()
                }}
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveName}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelEditName}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{room?.name}</span>
              {isOwner && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleStartEditName}
                  aria-label="编辑房间名"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </SettingRow>

        <SettingRow label="房间号">
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-sm">{room?.id}</code>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={copyRoomLink}
                  aria-label="复制房间链接"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>复制房间链接</TooltipContent>
            </Tooltip>
          </div>
        </SettingRow>

        <SettingRow label="同步偏移">
          <span className={`text-sm font-mono ${driftDisplay.isHigh ? 'text-yellow-500' : 'text-muted-foreground'}`}>
            {driftDisplay.label}
          </span>
        </SettingRow>

        <SettingRow label="音质" description={isOwner ? '切换后对下一首歌生效' : undefined}>
          {canAdjustAudioQuality ? (
            <Select
              value={String(room?.audioQuality ?? 320)}
              onValueChange={(v) => {
                const numeric = Number(v)
                const quality = (Number.isNaN(numeric) ? v : numeric) as AudioQuality
                onUpdateSettings({ audioQuality: quality })
                toast.success(`音质已切换为 ${getAudioQualityLabel(quality, platformStatus)}`)
              }}
            >
              <SelectTrigger className="h-8 w-[145px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {qualityOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    <div className="flex items-center gap-2">
                      <span>{opt.label}</span>
                      {opt.description && (
                        <span className="text-[10px] text-muted-foreground">({opt.description})</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm text-muted-foreground">
              {getAudioQualityLabel(room?.audioQuality ?? 320, platformStatus)}
            </span>
          )}
        </SettingRow>

        <SettingRow label="密码保护">
          {room?.hasPassword ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> 已设置
              </Badge>
              {roomPassword && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code
                      className="cursor-pointer rounded bg-muted px-2 py-0.5 text-xs transition-colors hover:bg-muted/80"
                      onClick={() => {
                        navigator.clipboard.writeText(roomPassword)
                        toast.success('密码已复制')
                      }}
                    >
                      {roomPassword}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>点击复制密码</TooltipContent>
                </Tooltip>
              )}
            </div>
          ) : (
            <Badge variant="outline" className="gap-1">
              <LockOpen className="h-3 w-3" /> 无密码
            </Badge>
          )}
        </SettingRow>
      </div>

      {isOwner && (
        <div>
          <h3 className="text-base font-semibold">房主设置</h3>
          <Separator className="mt-2 mb-4" />

          <SettingRow label="房间密码" description="开启后需输入密码才能进入">
            <Switch checked={passwordEnabled} onCheckedChange={handlePasswordToggle} />
          </SettingRow>

          <SettingRow label="隐藏房间" description="从大厅隐藏，可与永久房间同时开启；仍可通过完整房间号或邀请链接加入">
            <Switch
              aria-label="隐藏房间"
              checked={room?.hidden ?? false}
              onCheckedChange={(hidden) => {
                onUpdateSettings({ hidden })
                toast.success(hidden ? '房间已从大厅隐藏' : '房间已在大厅公开')
              }}
            />
          </SettingRow>

          <SettingRow label="永久房间" description="无论公开或隐藏，空房均不回收，服务重启后仍会保留">
            <Switch
              checked={room?.permanent ?? false}
              onCheckedChange={(permanent) => {
                onUpdateSettings({ permanent })
                toast.success(permanent ? '已设为永久房间' : '已改为临时房间')
              }}
            />
          </SettingRow>

          <SettingRow label="临时管理员删除单曲" description="允许临时管理员从播放列表删除单首歌曲">
            <Switch
              checked={room?.allowTemporaryAdminTrackRemoval ?? false}
              onCheckedChange={(allowTemporaryAdminTrackRemoval) => {
                onUpdateSettings({ allowTemporaryAdminTrackRemoval })
                toast.success(allowTemporaryAdminTrackRemoval ? '已允许临时管理员删除单曲' : '已限制临时管理员删除单曲')
              }}
            />
          </SettingRow>

          <SettingRow label="临时管理员清空歌单" description="允许临时管理员清空整个播放列表">
            <Switch
              checked={room?.allowTemporaryAdminQueueClear ?? false}
              onCheckedChange={(allowTemporaryAdminQueueClear) => {
                onUpdateSettings({ allowTemporaryAdminQueueClear })
                toast.success(allowTemporaryAdminQueueClear ? '已允许临时管理员清空歌单' : '已限制临时管理员清空歌单')
              }}
            />
          </SettingRow>

          <SettingRow label="播放后移除歌曲" description="切换到下一首成功后，自动从房间歌单移除上一首">
            <Switch
              aria-label="播放后移除歌曲"
              checked={room?.removePlayedTracks ?? false}
              onCheckedChange={(removePlayedTracks) => {
                onUpdateSettings({ removePlayedTracks })
                toast.success(removePlayedTracks ? '已开启播放后自动移除' : '已关闭播放后自动移除')
              }}
            />
          </SettingRow>

          <SettingRow
            label="私人漫游"
            description={
              creatorIsCurrentUser && statusLoaded && !creatorLoggedInToRoamingSource
                ? `需先登录房主的${ROAMING_SOURCE_LABELS[roamingSource]}账号`
                : '队列没有下一首时，使用房主账号继续个性化推荐'
            }
          >
            <Switch
              aria-label="私人漫游"
              checked={room?.roamingEnabled ?? false}
              onCheckedChange={(roamingEnabled) => {
                if (roamingEnabled && creatorIsCurrentUser && statusLoaded && !creatorLoggedInToRoamingSource) {
                  toast.error(`请先登录${ROAMING_SOURCE_LABELS[roamingSource]}账号`)
                  return
                }
                onUpdateSettings({ roamingEnabled })
              }}
            />
          </SettingRow>

          <SettingRow label="漫游平台" description="个性化推荐只使用房主自己的平台账号">
            <Select
              value={roamingSource}
              onValueChange={(value) => {
                const nextSource = value as RoamingSource
                onUpdateSettings({
                  roamingSource: nextSource,
                  roamingMode: nextSource === 'netease' ? roamingMode : 'DEFAULT',
                })
              }}
            >
              <SelectTrigger size="sm" className="w-[150px] max-w-[46vw]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="netease">网易云音乐</SelectItem>
                <SelectItem value="tencent">QQ音乐</SelectItem>
                <SelectItem value="kugou">酷狗音乐</SelectItem>
                <SelectItem value="kugou_concept">酷狗概念版</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow
            label="漫游模式"
            description={roamingSource === 'netease' ? roamingModeOption.description : '该平台目前固定使用默认推荐'}
          >
            <Select
              value={roamingSource === 'netease' ? roamingMode : 'DEFAULT'}
              disabled={roamingSource !== 'netease'}
              onValueChange={(value) => onUpdateSettings({ roamingMode: value as NeteaseRoamingMode })}
            >
              <SelectTrigger size="sm" className="w-[150px] max-w-[46vw]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROAMING_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {passwordEnabled && (
            <div className="flex gap-2 pb-2">
              <Input
                type="password"
                placeholder="输入新密码..."
                value={passwordInput}
                onChange={(e) => updatePasswordDraft({ input: e.target.value })}
                maxLength={LIMITS.ROOM_PASSWORD_MAX_LENGTH}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
              />
              <Button size="sm" onClick={handleSetPassword}>
                确认
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- 个人信息 ---- */}
      <div>
        <h3 className="text-base font-semibold">个人信息</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="昵称" description="修改后下次加入房间生效">
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => void handleNicknameBlur()}
            onKeyDown={(e) => e.key === 'Enter' && void handleNicknameBlur()}
            className="w-40"
            placeholder="输入昵称..."
          />
        </SettingRow>
      </div>
    </div>
  )
}
