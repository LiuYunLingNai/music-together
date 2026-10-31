import { Suspense, lazy, useMemo, type CSSProperties } from 'react'
import { MotionConfig } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getProxiedCoverUrl } from '@/lib/cover'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import type { VoteAction, VoteState } from '@music-together/shared'
import type { FoliaSharedProps } from './definition'
import type { FoliaModeId } from './registry'
import { FOLIA_MODE_RENDERERS } from './renderers'
import { useFoliaClock } from './stage/foliaClock'
import { useBeatFxTrack } from '@/hooks/useBeatFxTrack'
import { findFoliaActiveLineIndex, useFoliaLines, useFoliaTheme } from './stage/lyricAdapter'
import { FoliaControlBar } from './FoliaControlBar'
import { FoliaRenderer } from './FoliaRenderer'
import { useFoliaAudio } from './stage/foliaAudio'
import { FoliaAudioProvider } from './stage/foliaAudioContext'
import { useMirrorPreviewSignals } from './stage/foliaPreviewSignals'
import { useRandomFoliaMode } from './stage/useRandomFoliaMode'
import { useFoliaRenderState } from './stage/foliaRenderState'
import { useFoliaStyleWindowStore } from './stage/foliaStyleWindowStore'
import { createFoliaTuningResolver } from './stage/foliaTunings'
import { useFoliaAssetStore } from './stage/foliaAssetStore'
import { getRecentCompletedLine, getUpcomingLine } from './upstream/components/visualizer/runtime'
import { getLineRenderEndTime } from './upstream/utils/lyrics/renderHints'

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
  const tuningsFor = useMemo(
    () => createFoliaTuningResolver({ tunings: settings.tunings, fontScale: settings.fontScale }),
    [settings.tunings, settings.fontScale],
  )
  /**
   * 歌词样式窗口开着时，舞台上的歌词与几何背景不再画。
   *
   * 上游同一处（`useVisualizerRendererModel`）：`showText` 在设置窗口打开时为 false，
   * 几何背景也在子视图打开时禁用 —— 注释写明「子视图把这块整体盖住了，在这里画
   * 是唯一一笔白花的开销」。窗口里的实时预览本来就与舞台同源同钟，两边同时画
   * 同一份歌词既重复又互相看不见。
   */
  const styleWindowOpen = useFoliaStyleWindowStore((s) => s.open)
  const renderState = useFoliaRenderState()
  const audio = useFoliaAudio(renderState.paused || renderState.staticMode)
  // 自定义素材与歌词样式窗口共用一份 store：窗口里上传的头像/封面当场出现在舞台上。
  const cappellaEmojiImages = useFoliaAssetStore((s) => s.cappellaCustomEmojiImages)
  const cappellaAvatarImages = useFoliaAssetStore((s) => s.cappellaCustomAvatarImages)
  const monetPortraitImage = useFoliaAssetStore((s) => s.monetPortraitImage)
  const monetBackgroundImage = useFoliaAssetStore((s) => s.monetBackgroundImage)

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
  // 窗口的实时预览与视频层读同一组信号（上游 motionSignals 的宿主版本）。
  useMirrorPreviewSignals(currentTime, audio)
  // 每首随机样式：换歌时从池里换一种（上游 useRandomVisualizerMode）。
  useRandomFoliaMode(currentTrack?.id ?? null)
  // 智能动感模式：把当前歌曲的拍点表装进实时时钟（不改变任何画面，只是备好数据）。
  useBeatFxTrack()

  /**
   * 当前激活行下标。
   *
   * 只订阅 10 Hz store 时间推导出的离散行：同行内的时间更新不重渲染宿主。
   * 两个间隙的激活下标都可能为 -1，所以也比较最近结束行和下一行，保留
   * 间隙之间 seek 时的字幕更新。逐字动画仍由模式内部的 MotionValue 驱动。
   */
  const selectLineContext = useMemo(
    () => (state: ReturnType<typeof usePlayerStore.getState>) => {
      const time = Math.max(0, state.currentTime - lyricOffsetMs / 1000)
      const index = findFoliaActiveLineIndex(lines, time)
      return [
        index,
        index < 0 ? getRecentCompletedLine({ lines, currentLineIndex: index, currentTime: time, getLineEndTime: getLineRenderEndTime }) : null,
        index < 0 ? getUpcomingLine(lines, index, time) : null,
      ] as const
    },
    [lines, lyricOffsetMs],
  )
  const [currentLineIndex] = usePlayerStore(useShallow(selectLineContext))

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

  const background = useMemo(
    () => settings.background === 'solid'
      ? { transparent: true }
      : {
          ...settings.backgroundConfig,
          customImage: monetBackgroundImage ?? settings.backgroundConfig.customImage ?? null,
          ...(styleWindowOpen
            ? { common: { ...settings.backgroundConfig.common, disableGeometricBackground: true } }
            : {}),
        },
    [settings.background, settings.backgroundConfig, monetBackgroundImage, styleWindowOpen],
  )

  const modeProps: FoliaSharedProps = {
    ...audio,
    ...renderState,
    ...tuningsFor(mode),
    currentTime,
    duration: currentTrack?.duration ?? 0,
    currentLineIndex,
    lines,
    theme,
    // Match the upstream player-page flag: the mode stays visible even without an
    // active lyric, retaining its instrumental scene, tails and held subtitles.
    // 窗口打开时与上游一样停画歌词（窗口在后面把它整块盖住）。
    showText: !styleWindowOpen,
    songTitle,
    songArtist,
    songAlbum: currentTrack?.album,
    coverUrl,
    // 同一首歌每次进入都得到同一份布局 / 同一批头像：种子优先用曲目身份，
    // 缺失时回退到标题（与 cappella 上游的 `seed ?? titleText` 一致）。
    seed: currentTrack?.lyricId ?? songTitle ?? 'folia',
    cappellaCustomEmojiImages: cappellaEmojiImages,
    cappellaCustomAvatarImages: cappellaAvatarImages,
    monetPortraitImage,
    lyricsFontScale,
    subtitleFontScale,
    subtitleContentMode: settings.showTranslation
      ? settings.showRomanization
        ? 'both'
        : 'translation'
      : settings.showRomanization
        ? 'romanization'
        : 'none',
    // 莫奈/漫游的全局覆盖图来自素材 store（IndexedDB → objectURL，不进持久化设置）。
    // 窗口打开时与上游一样关掉几何背景那套常驻动画。
    background,
    // 上游 `useVisualizerRendererModel` 的 `backgroundStaticMode`：只暂停背景，不停模式层。
    // 上游还叠加了「latent 仅在播放页动态」与「非播放页且关掉首页动态背景」两条，
    // 本项目只有播放页，因此只剩用户自己的「背景动效」开关。
    backgroundStaticMode: !settings.backgroundMotion,
    onLyricLineSeek: onLyricSeek,
  }

  return (
    <div
      className="folia-root absolute inset-0 overflow-hidden"
      style={{
        '--folia-bar-offset': `${settings.barOffset}px`,
        backgroundColor: theme.backgroundColor,
      } as CSSProperties}
    >
      <FoliaAudioProvider value={audio}>
      <MotionConfig reducedMotion="user">
        <div className="folia-lyrics-layer absolute inset-0">
          {/* 舞台画布：背景层与模式层都在里面，各自可过渡（上游 VisualizerRenderer 的树）。
              错误边界由上层 `AudioPlayer` 的 `StageErrorBoundary` 提供：
              它会在捕获异常时把持久化舞台回写为 classic，因此这里不再套一层。 */}
          <FoliaRenderer
            {...modeProps}
            mode={mode}
            renderers={FOLIA_MODE_RENDERERS}
            // 切换时还在退场的旧模式要用它自己的调参（上游 `applyVisualizerTuning` 的语义）。
            tuningsFor={tuningsFor}
            animateStyleSwitch
            backgroundDim={settings.backgroundDim}
          />
        </div>
      </MotionConfig>
      </FoliaAudioProvider>

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
