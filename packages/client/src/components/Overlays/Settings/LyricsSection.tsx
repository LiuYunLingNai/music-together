import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { MusicSource } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { formatDuration } from '@/lib/format'
import { getLyricSourceOverride, setLyricSourceOverride, type LyricSourceOverride } from '@/lib/lyricSourceOverride'
import { PLATFORM_LABELS } from '@/lib/platform'
import type { LyricOrigin } from '@/lib/lyricPresentation'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LyricLineRulesEditor } from './LyricLineRulesEditor'
import { SettingRow } from './SettingRow'

const LYRIC_ORIGIN_LABELS: Record<LyricOrigin, string> = {
  platform: '平台歌词',
  ttml: 'AMLL TTML 逐词',
  supplement: '跨平台补充歌词',
}

interface PlatformLyricCandidate {
  source: MusicSource
  lyricId: string
  title: string
  artist: string[]
  duration: number
  preview?: string
  hasWordTiming?: boolean
  matchScore?: { score: number }
}

interface TtmlLyricCandidate {
  platform: 'ncm' | 'qq'
  id: string
  title: string
  artist: string[]
  score: number
}

const TTML_PLATFORM_LABELS: Record<TtmlLyricCandidate['platform'], string> = {
  ncm: '网易云 TTML',
  qq: 'QQ TTML',
}

function LyricSourceMatch() {
  const track = usePlayerStore((state) => state.currentTrack)
  const [override, setOverride] = useState<LyricSourceOverride | null>(() => getLyricSourceOverride(track))
  const [candidates, setCandidates] = useState<PlatformLyricCandidate[]>([])
  const [ttmlCandidates, setTtmlCandidates] = useState<TtmlLyricCandidate[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchTitle, setSearchTitle] = useState('')
  const [searchArtists, setSearchArtists] = useState('')
  const [selectingTtml, setSelectingTtml] = useState<string | null>(null)

  useEffect(() => {
    setOverride(getLyricSourceOverride(track))
    setCandidates([])
    setTtmlCandidates([])
    setSearched(false)
    setSearchTitle(track?.title ?? '')
    setSearchArtists(track?.artist.join(' / ') ?? '')
  }, [track])

  const search = async () => {
    if (!track) {
      toast.error('当前没有正在播放的歌曲')
      return
    }
    setLoading(true)
    setSearched(false)
    try {
      const title = searchTitle.trim() || track.title
      const artists = searchArtists
        .split(/[,，/、&]/)
        .map((artist) => artist.trim())
        .filter(Boolean)
      const params = new URLSearchParams({
        title,
        duration: String(track.duration),
      })
      if (track.lyricId) {
        params.set('source', track.metadataSource ?? track.source)
        params.set('lyricId', track.lyricId)
      }
      for (const artist of artists.length > 0 ? artists : track.artist) params.append('artists', artist)
      const response = await fetch(`${SERVER_URL}/api/music/lyric-candidates?${params}`, { credentials: 'include' })
      if (!response.ok) throw new Error('search failed')
      const data = (await response.json()) as {
        candidates?: PlatformLyricCandidate[]
        ttmlCandidates?: TtmlLyricCandidate[]
      }
      setCandidates(data.candidates ?? [])
      setTtmlCandidates(data.ttmlCandidates ?? [])
      setSearched(true)
    } catch {
      toast.error('歌词候选搜索失败')
    } finally {
      setLoading(false)
    }
  }

  const applyCandidate = (candidate: PlatformLyricCandidate) => {
    if (!track) return
    const selection: LyricSourceOverride = {
      kind: 'platform',
      source: candidate.source,
      lyricId: candidate.lyricId,
      title: candidate.title,
      artist: candidate.artist,
    }
    setLyricSourceOverride(track, selection)
    setOverride(selection)
    toast.success(`已改用${PLATFORM_LABELS[candidate.source]}的歌词`)
  }

  const applyTtmlCandidate = async (candidate: TtmlLyricCandidate) => {
    if (!track) return
    const candidateKey = `${candidate.platform}:${candidate.id}`
    setSelectingTtml(candidateKey)
    try {
      const params = new URLSearchParams({ platform: candidate.platform, id: candidate.id })
      const response = await fetch(`${SERVER_URL}/api/music/amll-ttml?${params}`, { credentials: 'include' })
      const text = response.ok ? await response.text() : ''
      if (!text.includes('<tt') && !text.includes('<?xml')) {
        toast.error('该 TTML 当前不可用，请换一个候选')
        return
      }
      const selection: LyricSourceOverride = {
        kind: 'ttml',
        platform: candidate.platform,
        id: candidate.id,
        title: candidate.title,
        artist: candidate.artist,
      }
      setLyricSourceOverride(track, selection)
      setOverride(selection)
      toast.success(`已改用${TTML_PLATFORM_LABELS[candidate.platform]}逐词歌词`)
    } finally {
      setSelectingTtml(null)
    }
  }

  const restoreAuto = () => {
    if (!track) return
    setLyricSourceOverride(track, null)
    setOverride(null)
    toast.success('已恢复自动选择歌词')
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">手动匹配歌词</p>
          <p className="text-xs text-muted-foreground">
            {override
              ? `当前指定：${
                  override.kind === 'ttml' ? TTML_PLATFORM_LABELS[override.platform] : PLATFORM_LABELS[override.source]
                } · ${override.title}`
              : '自动结果不满意时，可从其他平台或 AMLL 逐词库挑一份使用'}
          </p>
        </div>
        <div className="flex gap-2">
          {override && (
            <Button variant="outline" size="sm" onClick={restoreAuto}>
              恢复自动
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void search()} disabled={loading || !track}>
            {loading ? '搜索中…' : '搜索候选'}
          </Button>
        </div>
      </div>

      {track && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={searchTitle}
            onChange={(event) => setSearchTitle(event.target.value)}
            placeholder="搜索标题"
            aria-label="歌词搜索标题"
            className="text-xs"
          />
          <Input
            value={searchArtists}
            onChange={(event) => setSearchArtists(event.target.value)}
            placeholder="歌手，用 / 分隔"
            aria-label="歌词搜索歌手"
            className="text-xs"
          />
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <div
              key={`${candidate.source}:${candidate.lyricId}`}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {candidate.title} · {candidate.artist.join(' / ')}
                </p>
                {candidate.preview && (
                  <p className="truncate text-xs text-muted-foreground/80">「{candidate.preview}」</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {PLATFORM_LABELS[candidate.source]} · {formatDuration(candidate.duration)}
                  {candidate.hasWordTiming ? ' · 逐字' : ''}
                  {candidate.matchScore ? ` · 匹配度 ${Math.round(candidate.matchScore.score)}` : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant={
                  override?.kind === 'platform' &&
                  override.source === candidate.source &&
                  override.lyricId === candidate.lyricId
                    ? 'secondary'
                    : 'outline'
                }
                onClick={() => applyCandidate(candidate)}
              >
                {override?.kind === 'platform' &&
                override.source === candidate.source &&
                override.lyricId === candidate.lyricId
                  ? '使用中'
                  : '使用'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {ttmlCandidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">AMLL 逐词 TTML</p>
          {ttmlCandidates.map((candidate) => {
            const active =
              override?.kind === 'ttml' && override.platform === candidate.platform && override.id === candidate.id
            return (
              <div
                key={`${candidate.platform}:${candidate.id}`}
                className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {candidate.title} · {candidate.artist.join(' / ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {TTML_PLATFORM_LABELS[candidate.platform]} · 匹配度 {Math.round(candidate.score)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={active ? 'secondary' : 'outline'}
                  disabled={selectingTtml === `${candidate.platform}:${candidate.id}`}
                  onClick={() => void applyTtmlCandidate(candidate)}
                >
                  {selectingTtml === `${candidate.platform}:${candidate.id}` ? '检查中…' : active ? '使用中' : '使用'}
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {searched && candidates.length === 0 && ttmlCandidates.length === 0 && (
        <p className="text-xs text-muted-foreground">没有找到可信的匹配歌词。</p>
      )}
    </div>
  )
}

export function LyricsSection() {
  const s = useSettingsStore()
  const lyricOrigin = usePlayerStore((state) => state.lyricOrigin)
  const lyricProvider = usePlayerStore((state) => state.lyricProvider)
  const lyricConfidence = usePlayerStore((state) => state.lyricConfidence)

  return (
    <div className="space-y-6">
      {/* ---- 歌词源 ---- */}
      <div>
        <h3 className="text-base font-semibold">歌词源</h3>
        <Separator className="mt-2 mb-4" />
        <p className="mb-4 text-xs text-muted-foreground">
          当前来源：{lyricOrigin ? LYRIC_ORIGIN_LABELS[lyricOrigin] : '尚未加载'}
          {lyricProvider ? `（${PLATFORM_LABELS[lyricProvider]}）` : ''}
          {lyricConfidence != null && lyricConfidence > 0 ? ` · 置信度 ${Math.round(lyricConfidence * 100)}%` : ''}
        </p>

        <LyricSourceMatch />

        <SettingRow
          label="TTML 在线逐词歌词"
          description="启用 AMLL 逐词歌词库（仅网易云/QQ音乐）"
          onReset={s.ttmlEnabled !== s.ttmlEnabledDefault ? s.resetTtmlEnabled : undefined}
        >
          <Switch checked={s.ttmlEnabled} onCheckedChange={s.setTtmlEnabled} />
        </SettingRow>

        {s.ttmlEnabled && (
          <SettingRow
            label="TTML 歌词库地址"
            description="URL 模板：%s 替换为歌曲 ID，%f 替换为平台目录（ncm-lyrics / qq-lyrics）；未写 %f 时沿用旧的 ncm-lyrics 替换"
            onReset={s.ttmlDbUrl !== s.ttmlDbUrlDefault ? s.resetTtmlDbUrl : undefined}
          >
            <Input
              value={s.ttmlDbUrl}
              onChange={(e) => s.setTtmlDbUrl(e.target.value)}
              placeholder="https://api.beta.amllhub.bikonoo.com/api/v1/lyrics/ncm-lyrics/%s.ttml"
              className="w-64 text-xs"
            />
          </SettingRow>
        )}

        <SettingRow
          label="优先歌词源"
          description="同质量时优先；逐词能力更强的一方仍会胜出"
          onReset={s.lyricPreferredSource !== s.lyricPreferredSourceDefault ? s.resetLyricPreferredSource : undefined}
        >
          <Select
            value={s.lyricPreferredSource}
            onValueChange={(value) => s.setLyricPreferredSource(value as typeof s.lyricPreferredSource)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动择优</SelectItem>
              <SelectItem value="ttml">AMLL TTML</SelectItem>
              <SelectItem value="platform">平台歌词</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>

      {/* ---- 歌词过滤 ---- */}
      <div>
        <h3 className="text-base font-semibold">歌词过滤</h3>
        <Separator className="mt-2 mb-4" />
        <LyricLineRulesEditor />
      </div>

      {/* ---- 歌词布局 ---- */}
      <div>
        <h3 className="text-base font-semibold">歌词布局</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="对齐锚点"
          description="当前歌词行在视口中的锚定方式"
          onReset={s.lyricAlignAnchor !== s.lyricAlignAnchorDefault ? s.resetLyricAlignAnchor : undefined}
        >
          <Select
            value={s.lyricAlignAnchor}
            onValueChange={(v) => s.setLyricAlignAnchor(v as 'top' | 'center' | 'bottom')}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">顶部</SelectItem>
              <SelectItem value="center">居中</SelectItem>
              <SelectItem value="bottom">底部</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="对齐位置"
          description={`当前: ${Math.round(s.lyricAlignPosition * 100)}%`}
          onReset={s.lyricAlignPosition !== s.lyricAlignPositionDefault ? s.resetLyricAlignPosition : undefined}
        >
          <Slider
            value={[s.lyricAlignPosition * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => s.setLyricAlignPosition(v[0] / 100)}
            className="w-32"
          />
        </SettingRow>
      </div>

      {/* ---- 歌词动画 ---- */}
      <div>
        <h3 className="text-base font-semibold">歌词动画</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="弹簧动画"
          description="歌词行切换时的弹簧物理效果"
          onReset={s.lyricEnableSpring !== s.lyricEnableSpringDefault ? s.resetLyricEnableSpring : undefined}
        >
          <Switch checked={s.lyricEnableSpring} onCheckedChange={s.setLyricEnableSpring} />
        </SettingRow>

        <SettingRow
          label="模糊效果"
          description="非当前行歌词模糊"
          onReset={s.lyricEnableBlur !== s.lyricEnableBlurDefault ? s.resetLyricEnableBlur : undefined}
        >
          <Switch checked={s.lyricEnableBlur} onCheckedChange={s.setLyricEnableBlur} />
        </SettingRow>

        <SettingRow
          label="缩放效果"
          description="当前行歌词放大突出显示"
          onReset={s.lyricEnableScale !== s.lyricEnableScaleDefault ? s.resetLyricEnableScale : undefined}
        >
          <Switch checked={s.lyricEnableScale} onCheckedChange={s.setLyricEnableScale} />
        </SettingRow>

        <SettingRow
          label="逐词渐变宽度"
          description={`当前：${s.lyricWordFadeWidth.toFixed(2)} 倍字号`}
          onReset={s.lyricWordFadeWidth !== s.lyricWordFadeWidthDefault ? s.resetLyricWordFadeWidth : undefined}
        >
          <Slider
            value={[s.lyricWordFadeWidth * 100]}
            min={5}
            max={200}
            step={5}
            onValueChange={(v) => s.setLyricWordFadeWidth(v[0] / 100)}
            className="w-32"
          />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词交互</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="隐藏已播放歌词"
          description="逐渐收起当前进度之前的歌词行"
          onReset={s.lyricHidePassedLines !== s.lyricHidePassedLinesDefault ? s.resetLyricHidePassedLines : undefined}
        >
          <Switch checked={s.lyricHidePassedLines} onCheckedChange={s.setLyricHidePassedLines} />
        </SettingRow>

        <SettingRow
          label="显示歌词底栏"
          description="在歌词末尾显示当前歌曲和歌手信息"
          onReset={s.lyricShowBottomLine !== s.lyricShowBottomLineDefault ? s.resetLyricShowBottomLine : undefined}
        >
          <Switch checked={s.lyricShowBottomLine} onCheckedChange={s.setLyricShowBottomLine} />
        </SettingRow>

        <SettingRow
          label="敏感词遮罩"
          description="仅处理歌词数据中已标记的敏感词"
          onReset={
            s.lyricMaskObsceneWordsMode !== s.lyricMaskObsceneWordsModeDefault
              ? s.resetLyricMaskObsceneWordsMode
              : undefined
          }
        >
          <Select
            value={s.lyricMaskObsceneWordsMode || 'disabled'}
            onValueChange={(value) =>
              s.setLyricMaskObsceneWordsMode(value === 'disabled' ? '' : (value as 'full-mask' | 'partial-mask'))
            }
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">关闭</SelectItem>
              <SelectItem value="full-mask">全部遮罩</SelectItem>
              <SelectItem value="partial-mask">首尾保留</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        {s.lyricMaskObsceneWordsMode && (
          <SettingRow
            label="遮罩字符"
            description="用于替换敏感词的单个字符"
            onReset={
              s.lyricMaskObsceneWordChar !== s.lyricMaskObsceneWordCharDefault
                ? s.resetLyricMaskObsceneWordChar
                : undefined
            }
          >
            <Input
              value={s.lyricMaskObsceneWordChar}
              maxLength={1}
              onChange={(event) => s.setLyricMaskObsceneWordChar(event.target.value)}
              className="w-16 text-center"
              aria-label="敏感词遮罩字符"
            />
          </SettingRow>
        )}
      </div>

      {/* ---- 歌词字体 ---- */}
      <div>
        <h3 className="text-base font-semibold">歌词字体</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="字体粗细"
          description="字体粗细值（100-900）"
          onReset={s.lyricFontWeight !== s.lyricFontWeightDefault ? s.resetLyricFontWeight : undefined}
        >
          <NumericInput value={s.lyricFontWeight} onChange={s.setLyricFontWeight} min={100} max={900} />
        </SettingRow>

        <SettingRow
          label="字体大小"
          description="主歌词字号比例（10-200）"
          onReset={s.lyricFontSize !== s.lyricFontSizeDefault ? s.resetLyricFontSize : undefined}
        >
          <NumericInput value={s.lyricFontSize} onChange={s.setLyricFontSize} />
        </SettingRow>

        <SettingRow
          label="翻译字体大小"
          description="翻译歌词相对主歌词的字号比例（10-200）"
          onReset={
            s.lyricTranslationFontSize !== s.lyricTranslationFontSizeDefault
              ? s.resetLyricTranslationFontSize
              : undefined
          }
        >
          <NumericInput value={s.lyricTranslationFontSize} onChange={s.setLyricTranslationFontSize} />
        </SettingRow>

        <SettingRow
          label="罗马音字体大小"
          description="罗马音歌词相对主歌词的字号比例（10-200）"
          onReset={s.lyricRomanFontSize !== s.lyricRomanFontSizeDefault ? s.resetLyricRomanFontSize : undefined}
        >
          <NumericInput value={s.lyricRomanFontSize} onChange={s.setLyricRomanFontSize} />
        </SettingRow>
      </div>
    </div>
  )
}
