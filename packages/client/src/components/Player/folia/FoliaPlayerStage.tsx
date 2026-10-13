import { Suspense, lazy, useMemo, type CSSProperties } from 'react'
import { MotionConfig } from 'motion/react'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getProxiedCoverUrl } from '@/lib/cover'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import type { VoteAction, VoteState } from '@music-together/shared'
import type { FoliaSharedProps } from './definition'
import type { FoliaModeId } from './registry'
import { FOLIA_MODE_RENDERERS } from './renderers'
import { useFoliaClock } from './stage/foliaClock'
import { findFoliaActiveLineIndex, useFoliaLines, useFoliaTheme } from './stage/lyricAdapter'
import { FoliaControlBar } from './FoliaControlBar'
import { FoliaBackground } from './backgrounds/FoliaBackground'
import { useFoliaAudio } from './stage/foliaAudio'
import { useFoliaRenderState } from './stage/foliaRenderState'
import { getFoliaTuningProps } from './stage/foliaTunings'
import { useCappellaCustomImages } from './stage/cappellaAssets'
import { useMonetPortraitImage } from './stage/monetPortraitAssets'
import FoliaHarmonyOverlay from './stage/FoliaHarmonyOverlay'

// 播放列表浮岛：folia 舞台的队列外壳。惰性加载 —— 只在第一次打开时拉代码，
// 且不进主 chunk（与模式的懒加载同红线）。
const FoliaQueueIsland = lazy(() =>
  import('./FoliaQueueIsland').then((m) => ({ default: m.FoliaQueueIsland })),
)

interface FoliaPlayerStageProps {
  mode: FoliaModeId
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onLyricSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenChat: () => void
  onOpenQueue: () => void
  chatUnreadCount: number
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
  /** 播放列表浮层开关（folia 舞台用浮岛形态渲染，外壳在 folia-root 内）。 */
  queueOpen?: boolean
  onQueueOpenChange?: (open: boolean) => void
}

/**
 * Folia 播放器舞台宿主。
 *
 * 职责：
 *   ① 把本项目的数据源接到 folia 的 props 契约上
 *      （歌词 → `lyricAdapter`，时钟 → `foliaClock`，主题 → CSS 变量）；
 *   ② 按 `mode` 懒加载对应模式；
 *   ③ 组合独立背景、Folia 胶囊控制栏与播放器设置。
 *
 * ★ 播放、同步、投票、权限全部由上层透传的回调承担，本组件**不参与**
 *   房间权威状态 —— 与 `MineradioPlayerStage` 同一边界。因此切舞台不影响
 *   播放进度或房间同步。
 *
 * ★ 歌词偏移（`lyricOffsets` / 校准预览）在**时钟**上减掉，而不是挪歌词行：
 *   与 `LyricDisplay` / `LyricStage` 的做法一致，也让"校准拖动"能即时反映
 *   （拖动只改 store，`useFoliaClock` 的 store 订阅会立刻同步）。
 */
export function FoliaPlayerStage({
  mode,
  onPlay,
  onPause,
  onSeek,
  onLyricSeek,
  onNext,
  onPrev,
  onOpenChat,
  onOpenQueue,
  chatUnreadCount,
  activeVote,
  onCastVote,
  onStartVote,
  queueOpen,
  onQueueOpenChange,
}: FoliaPlayerStageProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const lyricOffsetPreview = usePlayerStore((s) => s.lyricOffsetPreview)
  const lyricOffsets = useSettingsStore((s) => s.lyricOffsets)
  const lyricFontSize = useSettingsStore((s) => s.lyricFontSize)
  const lyricTranslationFontSize = useSettingsStore((s) => s.lyricTranslationFontSize)
  const settings = useSettingsStore((s) => s.foliaSettings)
  const renderState = useFoliaRenderState()
  const audio = useFoliaAudio(renderState.paused || renderState.staticMode)
  const cappellaAssets = useCappellaCustomImages()
  const monetPortrait = useMonetPortraitImage()

  const sourceLines = useFoliaLines()
  const lines = useMemo(
    () =>
      sourceLines.map((line) => ({
        ...line,
        translation: settings.showTranslation ? line.translation : undefined,
        romanization: settings.showRomanization ? line.romanization : undefined,
      })),
    [sourceLines, settings.showTranslation, settings.showRomanization],
  )
  const theme = useFoliaTheme()

  // ---- 歌词偏移：校准预览优先，否则用持久化值（与 LyricDisplay 同判据）----
  const lyricOffsetKey = getLyricOffsetKey(currentTrack)
  const savedLyricOffsetMs = lyricOffsets[lyricOffsetKey ?? ''] ?? 0
  const isCalibrating = lyricOffsetPreview?.key === lyricOffsetKey
  const lyricOffsetMs = isCalibrating ? lyricOffsetPreview.offsetMs : savedLyricOffsetMs

  const { currentTime } = useFoliaClock(lyricOffsetMs)

  /**
   * 当前激活行下标。
   *
   * ★ 订阅**节流后的 store 值**（10 Hz），而不是逐帧读时钟：激活行是离散
   *   变化，10 Hz 判定足够（与 `LyricStage` 只在 store 更新时重算 `active`
   *   的取舍一致），也避免每帧触发一次 React 渲染。
   *   逐帧的连续性由模式内部的 `useMotionValueEvent` 消费 `currentTime`
   *   承担 —— 那才是逐字填充真正需要帧级精度的地方。
   */
  const storeTime = usePlayerStore((s) => s.currentTime)
  const currentLineIndex = useMemo(
    () => findFoliaActiveLineIndex(lines, Math.max(0, storeTime - lyricOffsetMs / 1000)),
    [lines, storeTime, lyricOffsetMs],
  )

  /**
   * 歌词字号 → folia 的 `lyricsFontScale`。
   *
   * 本项目用 `lyricFontSize`（百分数，出厂 90）表达字号，而 folia 用倍率。
   * 以 90 为基准换算，因此出厂设置下倍率为 1（与上游默认观感一致）。
   */
  const lyricsFontScale = (lyricFontSize / 90) * settings.fontScale
  const subtitleFontScale = (lyricTranslationFontSize / 90) * settings.subtitleScale

  const coverUrl = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : null
  const songTitle = currentTrack?.title ?? null
  const songArtist = currentTrack?.artist?.filter(Boolean).join(' / ') ?? null

  const ModeRenderer = FOLIA_MODE_RENDERERS[mode]

  const modeProps: FoliaSharedProps = {
    ...audio,
    ...renderState,
    ...getFoliaTuningProps(mode, settings),
    currentTime,
    currentLineIndex,
    lines,
    theme,
    // Match the upstream player-page flag: the mode stays visible even without an
    // active lyric, retaining its instrumental scene, tails and held subtitles.
    showText: true,
    showWaitingPlaceholder: false,
    songTitle,
    songArtist,
    songAlbum: currentTrack?.album,
    coverUrl,
    // 同一首歌每次进入都得到同一份布局 / 同一批头像：种子优先用曲目身份，
    // 缺失时回退到标题（与 cappella 上游的 `seed ?? titleText` 一致）。
    seed: currentTrack?.lyricId ?? songTitle ?? 'folia',
    cappellaCustomEmojiImages: cappellaAssets.emojiImages,
    cappellaCustomAvatarImages: cappellaAssets.avatarImages,
    monetPortraitImage: monetPortrait.monetPortraitImage,
    lyricsFontScale,
    subtitleFontScale,
    subtitleContentMode: settings.showTranslation
      ? settings.showRomanization
        ? 'both'
        : 'translation'
      : settings.showRomanization
        ? 'romanization'
        : 'none',
    onLyricLineSeek: onLyricSeek,
  }

  return (
    <div
      className="folia-root absolute inset-0 overflow-hidden"
      style={{ '--folia-bar-offset': `${settings.barOffset}px` } as CSSProperties}
    >
      <FoliaBackground theme={theme} coverUrl={coverUrl} audio={audio} renderState={renderState} />
      <MotionConfig reducedMotion="user">
        <div className="folia-lyrics-layer absolute inset-0">
          <Suspense fallback={<FoliaFallback />}>
            {/* 错误边界由上层 `AudioPlayer` 的 `StageErrorBoundary` 提供：
            它会在捕获异常时把持久化舞台回写为 classic，因此这里不再套一层。 */}
            <ModeRenderer {...modeProps} />
          </Suspense>
        </div>
        {/* 顶部和声叠层（上游 VisualizerRenderer 挂在模式渲染之外的同层语义）：
        数据来自 lyricAdapter 折叠的 isBG 背景唱词，不改变任何模式的歌词布局。 */}
        <FoliaHarmonyOverlay
          currentTime={currentTime}
          lines={lines}
          showText
          theme={theme}
          subtitleContentMode={modeProps.subtitleContentMode}
          subtitleFontScale={subtitleFontScale}
        />
      </MotionConfig>

      {/* 独立 Folia 胶囊外壳；权限、投票、去重与 Seek 预览仍共用 Transport。 */}
      <FoliaControlBar
        onPlay={onPlay}
        onPause={onPause}
        onSeek={onSeek}
        onNext={onNext}
        onPrev={onPrev}
        onOpenChat={onOpenChat}
        onOpenQueue={onOpenQueue}
        chatUnreadCount={chatUnreadCount}
        activeVote={activeVote}
        onCastVote={onCastVote}
        onStartVote={onStartVote}
      />

      {/* 播放列表浮岛：folia 舞台把抽屉替换为播放栏上方的暗玻璃卡片。
          打开时才挂载（lazy + 条件渲染），代码与 DOM 都按需出现。 */}
      {(queueOpen && onQueueOpenChange) && (
        <Suspense fallback={null}>
          <FoliaQueueIsland open={queueOpen} onOpenChange={onQueueOpenChange} />
        </Suspense>
      )}
    </div>
  )
}

/** 舞台加载中的占位：保持深色底，避免白闪（与 mineradio 舞台同做法）。 */
function FoliaFallback() {
  return <div className="absolute inset-0 bg-[#05070b]" aria-hidden="true" />
}
