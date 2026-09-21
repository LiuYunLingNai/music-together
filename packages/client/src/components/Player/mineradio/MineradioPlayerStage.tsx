import { getProxiedCoverUrl } from '@/lib/cover'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import type { VoteAction, VoteState } from '@music-together/shared'
import { MineradioControlBar } from './MineradioControlBar'
import { MineradioLyricStage } from './MineradioLyricStage'
import { AmbientBackdrop } from './AmbientBackdrop'
import { ParticleScene } from './particles/ParticleScene'
import { extractCoverPalette } from './lyrics/coverPalette'
import { clearCoverCache, loadCoverAssets, type CoverAssets } from './shared/CoverTextureLoader'
import {
  detectHardwareProfile,
  detectPowerContext,
  getRenderPolicy,
  type VisualQuality,
} from './shared/RenderPolicy'
import type { VisualModeId } from './shared/VisualMode'

interface MineradioPlayerStageProps {
  mode: VisualModeId
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
  quality: VisualQuality
  /** WebGL 不可用时回退到经典播放器 */
  onUnavailable: () => void
}

/**
 * Mineradio 播放器舞台。
 *
 * 全屏 3D 场景 + 透明前景层，而不是"窄列里放一块背景"：
 *
 *   ┌ 画布层（absolute inset-0）  粒子 + 封面卡片 + 世界空间歌词网格
 *   ├ 暗角层（pointer-events:none）
 *   └ 控制栏（底部居中胶囊，pointer-events:auto）
 *
 * 歌词已进入 WebGL（见 lyrics/），因此不再有 DOM 歌词层。
 * 播放、同步、投票、权限全部来自上层透传的回调，因此切换舞台
 * 不会影响房间权威状态。
 */
export function MineradioPlayerStage({
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
  quality,
  onUnavailable,
}: MineradioPlayerStageProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const lyricRenderer = useSettingsStore((s) => s.lyricRenderer)
  const lyricMotion = useSettingsStore((s) => s.lyricMotion)
  const lyricDisplayMode3d = useSettingsStore((s) => s.lyricDisplayMode3d)
  const lyricCustomLineCount = useSettingsStore((s) => s.lyricCustomLineCount)
  const lyricTranslationMode3d = useSettingsStore((s) => s.lyricTranslationMode3d)
  const visualBloom = useSettingsStore((s) => s.visualBloom)
  const visualEdge = useSettingsStore((s) => s.visualEdge)
  // 封面资源连同它所属的 URL 一起保存：切歌瞬间旧封面仍然渲染，
  // 直到新封面就绪，因此不需要在 effect 里同步清空状态（避免级联渲染）。
  const coverUrl = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : null
  const [loaded, setLoaded] = useState<{ url: string; assets: CoverAssets | null } | null>(null)

  // 画质策略：把用户设置（粒子溢光）与设备上下文一起传进去 ——
  // `getRenderPolicy` 是纯函数，便于测试；这里只负责收集输入。
  const policy = useMemo(
    () =>
      getRenderPolicy(quality, detectHardwareProfile(), {
        ...detectPowerContext(),
        bloomEnabled: visualBloom,
        edgeEnabled: visualEdge,
      }),
    [quality, visualBloom, visualEdge],
  )
  const cover = loaded && loaded.url === coverUrl ? loaded.assets : null

  // 从封面提取调色板，驱动歌词与粒子的配色。
  // 提取失败时返回默认冷色调，不影响渲染。
  const coverPalette = useMemo(() => {
    if (!cover) return null
    return extractCoverPalette(cover.image)
  }, [cover])

  // 封面资源：切歌时异步加载，失败不阻塞舞台渲染
  useEffect(() => {
    if (!coverUrl) return

    let cancelled = false
    void loadCoverAssets(coverUrl).then((assets) => {
      if (!cancelled) setLoaded({ url: coverUrl, assets })
    })

    return () => {
      cancelled = true
    }
  }, [coverUrl])

  // 舞台卸载时释放封面缓存，避免长时间运行的内存增长
  useEffect(() => {
    return () => clearCoverCache()
  }, [])

  return (
    <div
      className={cn('mt-mineradio-root absolute inset-0 overflow-hidden', policy.perfLevel <= 0 && 'mt-mineradio-root--low')}
      data-visual-mode={mode}
    >
      {/* 环境底色层：置于画布之下，避免整个舞台退化成纯黑。
          画布本身是透明的，因此这一层负责提供色彩与封面氛围。 */}
      <AmbientBackdrop accent={cover?.accent ?? null} lowQuality={policy.perfLevel <= 0} />

      {/* 画布层：全屏铺满。歌词默认在 3D 场景内渲染；
          当用户选择 AMLL 渲染器时由下方 DOM 层接管。

          ★ 这里**刻意不挂 onClick**：上游 Mineradio 没有"点击歌词跳转"这个
            功能（全仓唯一的画布 click 监听属于歌单架，见
            `04-shelf/05-card-interactions.js:70`；歌词相关零命中）。
            本项目曾在舞台根上挂一个 click → 歌词跳转，而画布同时承载
            "拖拽转物体"手势 —— 按住拖动时只要按下点恰好落在某一行歌词的
            投影矩形内，松手就会误触发跳转（用户实测："旋转相机时很容易
            误跳转歌词"）。

            拖拽转物体是本项目的核心交互（红线 22），改动它风险更大，
            因此按"对齐上游"删掉跳转入口本身，而不是给拖拽加更多门控。 */}
      <div className="absolute inset-0">
        <ParticleScene
          mode={mode}
          cover={cover}
          policy={policy}
          isPlaying={isPlaying}
          onContextLost={onUnavailable}
          showLyrics={lyricRenderer === 'webgl'}
          onOpenQueue={onOpenQueue}
          lyricOptions={{
            palette: cover ? coverPalette : null,
            displayMode: lyricDisplayMode3d,
            customLineCount: lyricCustomLineCount,
            motionStyle: lyricMotion,
            translationMode: lyricTranslationMode3d,
          }}
        />
      </div>

      {/* AMLL 回退：DOM 歌词层，仅在选择 amll 渲染器时挂载 */}
      {lyricRenderer === 'amll' && (
        <div className="mt-mineradio-lyrics-fallback">
          <MineradioLyricStage mode={mode} onLyricSeek={onLyricSeek} accent={cover?.accent ?? null} />
        </div>
      )}

      {/* 暗角：保证控制栏可读性，不参与交互 */}
      <div className="mt-mineradio-vignette pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* 底部悬浮玻璃控制台 */}
      <MineradioControlBar
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
    </div>
  )
}
