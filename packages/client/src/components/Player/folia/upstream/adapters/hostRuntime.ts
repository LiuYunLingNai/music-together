import React from 'react'
import { create } from 'zustand'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { buildAMLLLinesFromLrc } from '@/lib/lyricLrc'
import { getProxiedCoverUrl } from '@/lib/cover'
import { motionValue } from 'motion/react'
import type { AudioBands, Line } from '../types'
import { PlayerState } from '../types'
import {
    estimateLrcLineEndTimes,
    findFoliaActiveLineIndex,
    foldFoliaBackgroundVocals,
    hideCrowdedLeadingStaffBlock,
    toFoliaLine,
} from '../../stage/lyricAdapter'
import { attachFoliaInterludes } from '../../stage/lyricPresentation'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import { isIcuFoliaReady, loadIcuFolia, segmentIcuFolia } from '@/lib/lyrics/icuFolia'
import { compileLyricLineRules, type LyricLineRule } from '@/lib/lyrics/lyricLineRules'
import { HAN_OR_KANA } from '@/lib/lyrics/hanKanaText'

/**
 * 上游设置窗口与预览读的宿主运行时模块的替身合集。
 *
 * 上游窗口直接读它的播放 store、motionSignals 与 mod 注册表；本仓的对应状态在
 * `playerStore`、舞台的时钟与音频 context 里。这里按上游同一形状给出「当前展示的
 * 歌曲 / 歌词 / 封面 / 播放状态」的快照 store，窗口的实时预览与视频层都读它。
 */

type HostPlayerState = ReturnType<typeof usePlayerStore.getState>

/** 上游 `selectDisplaySong` 的形状：预览只读 `id` / `name`。 */
export interface DisplaySong {
    id: string
    name: string
}

/** 上游 `usePlaybackStore` 的形状（窗口用到的字段）。 */
export interface DisplayPlaybackState {
    currentTrack: DisplaySong | null
    lines: { lines: Line[] } | null
    duration: number
    currentLineIndex: number
    isPlaying: boolean
    coverUrl: string | null
}

/** 歌词转换按源对象、字幕开关与 icu 就绪状态缓存：store 每 100ms 更新一次，长歌词不该每次重转。 */
let lineCache: { ttml: unknown; lyric: string; tlyric: string; translation: boolean; romanization: boolean; icuReady: boolean; rules: readonly LyricLineRule[]; lines: Line[] } | null = null
let icuLoadStarted = false

/** 与舞台同源的 CJK 切词：窗口的实时预览也要拿到 `autoWordSegments`。 */
const bakeAutoWordSegments = (lines: Line[]): void => {
    if (!isIcuFoliaReady()) return
    for (const line of lines) {
        if (!line.fullText) continue
        const segments = segmentIcuFolia(line.fullText)
        if (segments) line.autoWordSegments = segments
    }
}

const displayLines = (state: HostPlayerState): Line[] => {
    const { showTranslation, showRomanization } = useSettingsStore.getState().foliaSettings
    const lineRules = useSettingsStore.getState().lyricLineRules
    if (lineCache
        && lineCache.ttml === state.ttmlLines
        && lineCache.lyric === state.lyric
        && lineCache.tlyric === state.tlyric
        && lineCache.translation === showTranslation
        && lineCache.romanization === showRomanization
        && lineCache.rules === lineRules
        && lineCache.icuReady === isIcuFoliaReady()) {
        return lineCache.lines
    }
    const source = state.ttmlLines && state.ttmlLines.length > 0
        ? state.ttmlLines
        : buildAMLLLinesFromLrc(state.lyric, state.tlyric)
    if (!isIcuFoliaReady() && !icuLoadStarted
        && source.some((line) => HAN_OR_KANA.test((line.words ?? []).map((word) => word.word ?? '').join('')))) {
        icuLoadStarted = true
        void loadIcuFolia().then((ok) => {
            if (!ok) return
            lineCache = null
            usePlaybackStore.setState(snapshot())
        })
    }
    // 与舞台同判据：关掉的翻译 / 音译在窗口的实时预览里也不该出现。
    const estimateLrcTiming = !(state.ttmlLines && state.ttmlLines.length > 0)
    const timedSource = estimateLrcTiming ? estimateLrcLineEndTimes(source) : source
    const folded = foldFoliaBackgroundVocals(
        timedSource.map((line, index) => toFoliaLine(line, index, estimateLrcTiming)),
    )
    const built = attachFoliaInterludes(hideCrowdedLeadingStaffBlock(folded))
    bakeAutoWordSegments(built)
    const shouldHideLine = compileLyricLineRules(lineRules)
    const lines = built
        .filter((line) => !shouldHideLine(line.fullText))
        .map((line) => ({
            ...line,
            translation: showTranslation ? line.translation : undefined,
            romanization: showRomanization ? line.romanization : undefined,
        }))
    lineCache = {
        ttml: state.ttmlLines,
        lyric: state.lyric,
        tlyric: state.tlyric,
        translation: showTranslation,
        romanization: showRomanization,
        icuReady: isIcuFoliaReady(),
        rules: lineRules,
        lines,
    }
    return lines
}

/** 歌曲对象同样按引用缓存：视频层靠它判断换歌（引用相等）。 */
let songCache: { track: HostPlayerState['currentTrack'] | undefined; song: DisplaySong | null } = { track: undefined, song: null }
const displaySong = (track: HostPlayerState['currentTrack']): DisplaySong | null => {
    if (songCache.track === track) return songCache.song
    const song = track ? { id: track.id, name: track.title } : null
    songCache = { track, song }
    return song
}

const snapshot = (): DisplayPlaybackState => {
    const state = usePlayerStore.getState()
    const lines = displayLines(state)
    // 与舞台同一口径：歌词偏移从时钟里减掉，窗口预览的当前行才不会和舞台差一行。
    const offsetKey = getLyricOffsetKey(state.currentTrack)
    const preview = state.lyricOffsetPreview
    const offsetMs = preview?.key === offsetKey
        ? preview.offsetMs
        : useSettingsStore.getState().lyricOffsets[offsetKey ?? ''] ?? 0
    return {
        currentTrack: displaySong(state.currentTrack),
        lines: lines.length > 0 ? { lines } : null,
        duration: state.duration,
        currentLineIndex: findFoliaActiveLineIndex(lines, Math.max(0, state.currentTime - offsetMs / 1000)),
        isPlaying: state.isPlaying,
        coverUrl: state.currentTrack?.cover ? getProxiedCoverUrl(state.currentTrack.cover) : null,
    }
}

/**
 * 上游 `stores/usePlaybackStore` 的读取面。
 *
 * 做成真 store 并在宿主播放状态变化时同步：窗口的实时预览订阅它，
 * 视频层还按其 `(state, previous)` 判断换歌 / 播放状态切换 —— 因此这里
 * 必须给出带前后参数的订阅（早先的替身丢掉了参数，视频层的回调会拿到 undefined）。
 */
export const usePlaybackStore = create<DisplayPlaybackState>(() => snapshot())
usePlayerStore.subscribe(() => usePlaybackStore.setState(snapshot()))
// 字幕开关与已保存的歌词偏移住在设置 store：暂停时玩家 store 不再刷新，
// 窗口里的实时预览会一直停在旧内容，所以这两处变化也要重出版快照。
useSettingsStore.subscribe((state, previous) => {
    if (state.foliaSettings === previous.foliaSettings && state.lyricOffsets === previous.lyricOffsets) return
    usePlaybackStore.setState(snapshot())
})

export const selectDisplayPlayerState = (state: DisplayPlaybackState) =>
    (state.isPlaying ? PlayerState.PLAYING : PlayerState.PAUSED)

export const selectDisplayLyrics = (state: DisplayPlaybackState) => state.lines
export const selectDisplaySong = (state: DisplayPlaybackState) => state.currentTrack
export const selectDisplayDuration = (state: DisplayPlaybackState) => state.duration
export const selectDisplayCoverUrl = (state: DisplayPlaybackState) => state.coverUrl

/**
 * 上游 `stores/motionSignals`：歌词时钟与音频电平。
 *
 * 由舞台每帧写入（`stage/foliaPreviewSignals.ts`）：窗口的实时预览与视频层
 * 都是这些 MotionValue 的订阅者。舞台未挂载时它们停在 0，窗口也不会打开。
 */
export const lyricCurrentTime = motionValue(0)
export const currentTime = motionValue(0)
export const audioPower = motionValue(0)
export const audioBands: AudioBands = {
    bass: motionValue(0),
    lowMid: motionValue(0),
    mid: motionValue(0),
    vocal: motionValue(0),
    treble: motionValue(0),
    spectrum: motionValue(new Uint8Array(64)),
}

/** 上游 mod 注册表：本仓没有模组系统，恒为空。 */
export interface FoliumRegistryEntryLike { def: { target?: string }; [key: string]: unknown }
export const useFoliumRegistryEntries = (registry: unknown): FoliumRegistryEntryLike[] => { void registry; return [] }
export const getVisualizerRegistryEntries = (): unknown[] => []
export const useMissingFoliumSelections = (): { kind: 'visualizer' | 'background'; modId: string }[] => []

/** 上游 mod 调参 / 背景注册表：本仓没有模组系统，给空注册表。 */
export const tuningsRegistry = { entries: [] as FoliumRegistryEntryLike[] }
export const backgroundsRegistry = { entries: [] as FoliumRegistryEntryLike[] }
export const visualizersRegistry = { entries: [] as FoliumRegistryEntryLike[] }

/** 上游 mod 调参卡片：没有 mod 时什么都不画。 */
export const FoliumTuningCards: React.FC<Record<string, unknown>> = () => null

/** 上游 `useFoliumTunings` / `useFoliumVisualizerSettings`：没有 mod 时返回空对象。 */
export const useFoliumTunings = (mode: string) => { void mode; return {} }
export const useFoliumVisualizerSettings = (mode?: string) => { void mode; return {} }

/** 上游 `pickRandomVisualizerMode`：按池随机。 */
export const pickRandomVisualizerMode = (pool: readonly string[]): string | null =>
    pool.length === 0 ? null : pool[Math.floor(Math.random() * pool.length)]
