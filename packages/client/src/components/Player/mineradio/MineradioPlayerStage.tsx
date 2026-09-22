import { getProxiedCoverUrl } from '@/lib/cover'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VoteAction, VoteState } from '@music-together/shared'
import { MineradioControlBar } from './MineradioControlBar'
import { MineradioLyricStage } from './MineradioLyricStage'
import { AmbientBackdrop } from './AmbientBackdrop'
import { ParticleScene } from './particles/ParticleScene'
import { SHELF_CENTER, shelfSideX } from './particles/floatingSongCard'
import {
  STAGE_PAN_DURATION_MS,
  STAGE_PAN_REDUCED_MS,
  clearStageSafeArea,
  prefersReducedMotion,
  publishStagePanFraction,
  resolveStagePanFraction,
  setStagePanDuration,
} from './particles/stageSafeArea'
import { extractCoverPalette } from './lyrics/coverPalette'
import { clearCoverCache, loadCoverAssets, type CoverAssets } from './shared/CoverTextureLoader'
import { detectHardwareProfile, detectPowerContext, getRenderPolicy, type VisualQuality } from './shared/RenderPolicy'
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

  /**
   * 侧栏安全区（第三十三轮）。
   *
   * `--mt-player-safe-left/right` 是 `calc(clamp(...) + 304px)` 这类**未求值**
   * 的自定义属性 —— `getPropertyValue` 返回原样 token 串、`parseFloat` 得 NaN。
   * 因此把变量当 `width` 挂在两个零高度探针上，让**浏览器**去算，再读
   * `offsetWidth`。安全区的唯一事实来源仍是 `RoomPage`，本模块不另存一份。
   *
   * 探针由 `RoomSidePanel` 的定位容器（写有 `--mt-player-*` 的那个节点）
   * 继承，因此宽度语义与面板的内边距完全一致。
   *
   * ★ 用 ResizeObserver 盯探针自身，而**不是**在每次渲染后读 ——
   *   面板开关改的是**祖先的内联 style**，本组件不因此重渲染，无 deps 的
   *   effect 也不会跑；而探针宽度变化一定会触发 ResizeObserver。
   *   同时也避开了"每次渲染都强制同步布局"的开销。
   */
  const rootRef = useRef<HTMLDivElement>(null)
  const leftProbeRef = useRef<HTMLDivElement>(null)
  const rightProbeRef = useRef<HTMLDivElement>(null)

  const syncSafeArea = useCallback(() => {
    const left = leftProbeRef.current?.offsetWidth ?? 0
    const right = rightProbeRef.current?.offsetWidth ?? 0
    // 分母用**舞台自身宽度**：面板是相对该容器定位的，用 window.innerWidth
    // 会因页面 p-2/p-3/p-4 外边距把比例算小。
    const stageWidth = rootRef.current?.offsetWidth ?? window.innerWidth
    const stageHeight = rootRef.current?.offsetHeight ?? window.innerHeight
    // ★ 构图范围必须按**画布自身的宽高比**实算（§5.4 C1/C2）。
    //   three 的 `fov` 是垂直 FOV，固定世界点的**水平**屏幕占比随宽高比变化 ——
    //   用一对写死的常量会让窄窗口让不够、超宽窗口让过头。
    //   画布是舞台盒子（已扣掉 header 与控制栏高度），**不等于视口**。
    const aspect = stageHeight > 0 ? stageWidth / stageHeight : 16 / 9
    // 卡片列中心与相机基线也必须用**当前真实值**（模式不同基线不同）
    const shelfColumnX = shelfSideX() + SHELF_CENTER.x
    publishStagePanFraction(resolveStagePanFraction(left, right, stageWidth, aspect, shelfColumnX, mode))
  }, [mode])

  useEffect(() => {
    const probes = [leftProbeRef.current, rightProbeRef.current].filter(Boolean) as HTMLDivElement[]
    const observer = new ResizeObserver(syncSafeArea)
    for (const probe of probes) observer.observe(probe)
    // ★ 舞台根也必须被观察：`syncSafeArea` 现在按**画布宽高比**实算构图范围
    //   （§5.4 C1/C2），而窗口缩放会改变舞台的高与宽 —— 只盯探针的话，
    //   纯高度变化（宽度不变、面板不变）不会触发探针 resize，比例就更新不了。
    if (rootRef.current) observer.observe(rootRef.current)
    // 视口变化会同时改内边距（含 clamp/vw）与舞台宽度，兜一次同步
    window.addEventListener('resize', syncSafeArea)
    /**
     * 退让过渡：与经典播放器的 `transition: padding-inline 200ms ease-out`
     * **同值同曲线**；`prefers-reduced-motion: reduce` 时立即到位（对应 CSS 的
     * `0.01ms`）。缓动本身在 `CameraRig` 逐帧推进，这里只设定时长。
     */
    const motionQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    // ★ 用**已持有**的 `motionQuery.matches` 读当前值，不再调
    //   `prefersReducedMotion()` —— 后者内部会 `matchMedia(...)` **新建**一个
    //   MediaQueryList（§5.4 D6）。这里已经有一个现成的，读它就够。
    //   非泄漏（MQL 会被 GC），只是无谓的对象创建。
    const applyDuration = () => {
      const reduced = motionQuery ? motionQuery.matches : prefersReducedMotion()
      setStagePanDuration(reduced ? STAGE_PAN_REDUCED_MS : STAGE_PAN_DURATION_MS)
    }
    applyDuration()
    motionQuery?.addEventListener('change', applyDuration)
    syncSafeArea()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncSafeArea)
      motionQuery?.removeEventListener('change', applyDuration)
      // 模块级单例的清理义务（红线 22）：不得把平移残留给下一个舞台
      clearStageSafeArea()
    }
  }, [syncSafeArea])

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
      ref={rootRef}
      // ★ 低功耗档必须用 `policy.lowPower`，**不能**用 `policy.perfLevel <= 0`。
      //
      //   `perfLevel` 是**画质档**派生值（`runtimePerfBudgetLevel`），出厂
      //   `eco` 恒为 0 —— 而 `visualQuality` 出厂 `'auto'` → `detectDefaultQuality()`
      //   → `'eco'`。于是"低功耗"分支对**所有默认用户**恒成立：上游 Mineradio
      //   的 `#album-bg`（封面 120px 模糊铺底）被静默跳过，只剩基色渐变。
      //
      //   上游对 `#album-bg` **没有任何画质档门控**（`public/css/index.css:1063`
      //   只按 `.visible` 切换，`07-fx/02-accent-background-controls.js` 也不看
      //   `performanceQuality`）。画质档门控视觉特性同时违反红线 8。
      className={cn('mt-mineradio-root absolute inset-0 overflow-hidden', policy.lowPower && 'mt-mineradio-root--low')}
      data-visual-mode={mode}
    >
      {/* 侧栏安全区探针：把 `--mt-player-safe-*` 当 width 用，由浏览器求出
          真实像素值（自定义属性本身不做 calc 求值）。零尺寸、零布局影响。 */}
      <div
        ref={leftProbeRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 'var(--mt-player-safe-left, 0px)',
          height: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />
      <div
        ref={rightProbeRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 'var(--mt-player-safe-right, 0px)',
          height: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />

      {/* 环境底色层：置于画布之下，避免整个舞台退化成纯黑。
          画布本身是透明的，因此这一层负责提供色彩与封面氛围。 */}
      <AmbientBackdrop accent={cover?.accent ?? null} lowQuality={policy.lowPower} />

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
