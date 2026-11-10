import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { storage } from '@/lib/storage'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useAccountStore } from '@/stores/accountStore'
import type { AudioQuality, NeteaseRoamingMode, RoamingSource, TransitionMode } from '@music-together/shared'
import { CROSSFADE_DEFAULT_SEC, CROSSFADE_MAX_SEC, CROSSFADE_MIN_SEC, LIMITS, NETEASE_ROAMING_SCENES } from '@music-together/shared'
import { Check, Copy, Lock, LockOpen, Pencil, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SettingRow } from './SettingRow'
import { SettingsSection } from './SettingsSection'
import { getAudioQualityLabel, getAudioQualityOptions } from '@/lib/audioQuality'
import { updateCurrentNickname } from '@/lib/profileApi'
import { useAuth } from '@/hooks/useAuth'

const ROAMING_BASE_MODES: { value: string; label: string; description: string }[] = [
  { value: 'DEFAULT', label: '默认漫游', description: '综合听歌记录，常规个性化推荐' },
  { value: 'FAMILIAR', label: '熟悉模式', description: '多推收藏、常听与相似曲风' },
  { value: 'EXPLORE', label: '探索模式', description: '多推新歌、冷门歌，拓展曲库' },
  { value: 'PUZZLE_MODE_RCMD', label: '拼图模式', description: '按听歌偏好拼合推荐' },
  { value: 'SCENE_RCMD', label: '场景推荐', description: '按心情、活动、曲风或语言选场景' },
  { value: 'aidj', label: 'AI DJ', description: 'AI 串烧混剪，曲间带过渡衔接' },
]

const SCENE_CATEGORY_LABELS: Record<string, string> = {
  mood: '心情',
  activity: '活动',
  genre: '曲风',
  language: '语言',
}

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
    automixEnabled?: boolean
    transitionMode?: TransitionMode
    crossfadeMaxSec?: number
    automixPerformance?: boolean
    roamingSource?: RoamingSource
    roamingMode?: NeteaseRoamingMode
  }) => Promise<boolean>
}

export function RoomSettingsSection({ onUpdateSettings }: RoomSettingsSectionProps) {
  const submitSettings = async (settings: Parameters<typeof onUpdateSettings>[0], message: string) => {
    const confirmed = await onUpdateSettings(settings)
    if (confirmed) toast.success(message)
    else toast.error('未收到设置确认，请检查连接和房间当前状态')
    return confirmed
  }
  const room = useRoomStore((s) => s.room)
  const [crossfadeDraft, setCrossfadeDraft] = useState<number | null>(null)
  const crossfadeMaxSec = crossfadeDraft ?? room?.crossfadeMaxSec ?? CROSSFADE_DEFAULT_SEC
  const transitionMode = room?.transitionMode ?? 'automix'
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
  const isSceneMode = roamingMode.startsWith('SCENE_RCMD:')
  const roamingBaseMode = isSceneMode ? 'SCENE_RCMD' : roamingMode
  const roamingScene = isSceneMode ? roamingMode.slice('SCENE_RCMD:'.length) : 'EXERCISE'
  const roamingBaseOption = ROAMING_BASE_MODES.find((option) => option.value === roamingBaseMode)
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
      void submitSettings({ password: null }, '密码已移除')
    } else {
      updatePasswordDraft({ enabled: true })
    }
  }

  const handleSetPassword = () => {
    if (!passwordInput.trim()) {
      toast.error('请输入密码')
      return
    }
    void submitSettings({ password: passwordInput.trim() }, '密码已设置')
    updatePasswordDraft({ input: '' })
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
    void submitSettings({ name: trimmed }, '房间名已更新')
    setEditingName(false)
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
                void submitSettings({ audioQuality: quality }, `音质已切换为 ${getAudioQualityLabel(quality, platformStatus)}`)
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

      <SettingsSection
        title="播放过渡"
        description={isOwner ? '房间级设置，所有成员共享同一段过渡' : '房间级设置，所有成员共享同一段过渡；仅房主可以修改'}
        badge="room"
      >
        <SettingRow
          label="自动混音"
          description={
            room?.automixEnabled
              ? '当前曲目结束前与下一首重叠过渡，落点由服务端按节拍与段落统一编排'
              : '关闭时到点直接切歌，只有各设备的交叉淡化兜底'
          }
        >
          <Switch
            aria-label="自动混音"
            checked={room?.automixEnabled ?? false}
            disabled={!isOwner}
            onCheckedChange={(automixEnabled) => {
              void submitSettings(
                { automixEnabled },
                automixEnabled ? '已开启自动混音' : '已关闭自动混音',
              )
            }}
          />
        </SettingRow>

        {room?.automixEnabled && (
          <>
            <SettingRow
              label="过渡方式"
              description="自动混音按节拍与段落规划落点；交叉淡化使用固定时长的等功率淡化"
            >
              <Select
                value={transitionMode}
                disabled={!isOwner}
                onValueChange={(value) => {
                  void submitSettings(
                    { transitionMode: value as TransitionMode },
                    value === 'automix' ? '已切换为自动混音' : '已切换为交叉淡化',
                  )
                }}
              >
                <SelectTrigger className="w-32" aria-label="过渡方式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automix">自动混音</SelectItem>
                  <SelectItem value="crossfade">交叉淡化</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            {transitionMode === 'crossfade' ? (
              <SettingRow label="淡化时长" description={`固定 ${crossfadeMaxSec} 秒等功率交叉淡化`}>
                <div className="flex w-52 items-center gap-3">
                  <Slider
                    aria-label="交叉淡化时长"
                    min={CROSSFADE_MIN_SEC}
                    max={CROSSFADE_MAX_SEC}
                    step={1}
                    disabled={!isOwner}
                    value={[crossfadeMaxSec]}
                    onValueChange={([next]) => setCrossfadeDraft(next ?? CROSSFADE_DEFAULT_SEC)}
                    onValueCommit={([next]) => {
                      setCrossfadeDraft(null)
                      void submitSettings(
                        { crossfadeMaxSec: next ?? CROSSFADE_DEFAULT_SEC },
                        `交叉淡化已设为 ${next ?? CROSSFADE_DEFAULT_SEC} 秒`,
                      )
                    }}
                  />
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                    {crossfadeMaxSec} 秒
                  </span>
                </div>
              </SettingRow>
            ) : (
              <SettingRow label="表演模式" description="在鼓组换手前做 build-up，让过渡被听见">
                <Switch
                  aria-label="表演模式"
                  checked={room?.automixPerformance ?? false}
                  disabled={!isOwner}
                  onCheckedChange={(automixPerformance) => {
                    void submitSettings(
                      { automixPerformance },
                      automixPerformance ? '已开启表演模式' : '已关闭表演模式',
                    )
                  }}
                />
              </SettingRow>
            )}
          </>
        )}
      </SettingsSection>

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
                void submitSettings({ hidden }, hidden ? '房间已从大厅隐藏' : '房间已在大厅公开')
              }}
            />
          </SettingRow>

          <SettingRow label="永久房间" description="无论公开或隐藏，空房均不回收，服务重启后仍会保留">
            <Switch
              checked={room?.permanent ?? false}
              onCheckedChange={(permanent) => {
                void submitSettings({ permanent }, permanent ? '已设为永久房间' : '已改为临时房间')
              }}
            />
          </SettingRow>

          <SettingRow label="临时管理员删除单曲" description="允许临时管理员从播放列表删除单首歌曲">
            <Switch
              checked={room?.allowTemporaryAdminTrackRemoval ?? false}
              onCheckedChange={(allowTemporaryAdminTrackRemoval) => {
                void submitSettings({ allowTemporaryAdminTrackRemoval }, allowTemporaryAdminTrackRemoval ? '已允许临时管理员删除单曲' : '已限制临时管理员删除单曲')
              }}
            />
          </SettingRow>

          <SettingRow label="临时管理员清空歌单" description="允许临时管理员清空整个播放列表">
            <Switch
              checked={room?.allowTemporaryAdminQueueClear ?? false}
              onCheckedChange={(allowTemporaryAdminQueueClear) => {
                void submitSettings({ allowTemporaryAdminQueueClear }, allowTemporaryAdminQueueClear ? '已允许临时管理员清空歌单' : '已限制临时管理员清空歌单')
              }}
            />
          </SettingRow>

          <SettingRow label="播放后移除歌曲" description="切换到下一首成功后，自动从房间歌单移除上一首">
            <Switch
              aria-label="播放后移除歌曲"
              checked={room?.removePlayedTracks ?? false}
              onCheckedChange={(removePlayedTracks) => {
                void submitSettings({ removePlayedTracks }, removePlayedTracks ? '已开启播放后自动移除' : '已关闭播放后自动移除')
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
            description={roamingSource === 'netease' ? (roamingBaseOption?.description ?? '') : '该平台目前固定使用默认推荐'}
          >
            <Select
              value={roamingSource === 'netease' ? roamingBaseMode : 'DEFAULT'}
              disabled={roamingSource !== 'netease'}
              onValueChange={(value) =>
                onUpdateSettings({
                  roamingMode: (value === 'SCENE_RCMD'
                    ? `SCENE_RCMD:${roamingScene}`
                    : value) as NeteaseRoamingMode,
                })
              }
            >
              <SelectTrigger size="sm" className="w-[150px] max-w-[46vw]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROAMING_BASE_MODES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {roamingSource === 'netease' && roamingBaseMode === 'SCENE_RCMD' && (
            <SettingRow label="场景" description="按心情、活动、曲风或语言挑选推荐场景">
              <Select
                value={roamingScene}
                onValueChange={(value) =>
                  onUpdateSettings({ roamingMode: `SCENE_RCMD:${value}` as NeteaseRoamingMode })
                }
              >
                <SelectTrigger size="sm" className="w-[150px] max-w-[46vw]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['mood', 'activity', 'genre', 'language'].map((category) => (
                    <SelectGroup key={category}>
                      <SelectLabel>{SCENE_CATEGORY_LABELS[category] ?? category}</SelectLabel>
                      {NETEASE_ROAMING_SCENES.filter((scene) => scene.category === category).map((scene) => (
                        <SelectItem key={scene.id} value={scene.id}>
                          {scene.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          )}

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
