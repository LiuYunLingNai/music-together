import { Component, Suspense, lazy, useCallback, useMemo, type ReactNode } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VoteAction, VoteState } from '@music-together/shared'
import { useVisualStageSupport } from '@/hooks/useVisualStageSupport'
import { ClassicPlayerStage } from './classic/ClassicPlayerStage'
import { VisualModeMenu, type StageMode } from './mineradio/VisualModeMenu'
import { detectDefaultQuality, type VisualQuality } from './mineradio/shared/RenderPolicy'
import { isVisualStageId } from './mineradio/shared/VisualMode'

/**
 * Mineradio 舞台按需加载。
 *
 * 关键：three.js 与 @react-three/fiber 只在用户真正切到视觉模式时
 * 才被请求与解析。经典播放器路径完全不会加载这部分代码。
 */
const MineradioPlayerStage = lazy(() =>
  import('./mineradio/MineradioPlayerStage').then((m) => ({ default: m.MineradioPlayerStage })),
)

/**
 * 视觉舞台的错误边界。
 *
 * `handleUnavailable` 只覆盖"舞台已挂载后"的 WebGL 上下文丢失；这里补上
 * 另两类构造期失败 —— ①懒加载 chunk 请求失败（弱网 / 部署后旧 hash 失效，
 * React.lazy 的 rejection 沿组件树向上抛）；②R3F `<Canvas>` 创建 WebGL
 * 上下文即抛错。没有这一层时异常会一路炸到 `RouteErrorBoundary`，把用户
 * 踢回首页；有这一层时降级为持久化设置回写 `classic`，播放不受影响
 * （播放所有权在 `useHowl`/`usePlayerSync`，位于舞台之外）。
 */
class StageErrorBoundary extends Component<
  { stageKey: string; onUnavailable: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[audio-player] visual stage failed; falling back to classic', error)
    // ★ 必须真的回写 classic。
    //
    //   此前这里只打日志、render() 返回 null —— 用户看到的是**一块空白面板**
    //   且播放器控制永久消失（只能切模式或刷新才能恢复）。`onUnavailable`
    //   在 props 里声明了却从未被调用，`handleUnavailable` 也就永远不会把
    //   持久化的舞台设置改回 'classic'。
    //
    //   回写后父组件会重渲染并走经典分支；本边界随后因 stageKey 变化而复位。
    this.props.onUnavailable()
  }

  componentDidUpdate(prevProps: { stageKey: string }) {
    // 用户切到另一个视觉模式时重置边界，允许再次尝试
    if (prevProps.stageKey !== this.props.stageKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

interface AudioPlayerProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onLyricSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenChat: () => void
  onOpenQueue: () => void
  chatUnreadCount: number
  view: 'player' | 'playlist'
  onToggleView: () => void
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

/**
 * 播放器外壳。
 *
 * 职责仅限于：
 * 1. 当前是经典播放器还是 Mineradio 舞台
 * 2. 舞台切换菜单
 * 3. 把既有播放回调透传给选中的舞台
 * 4. 歌单页切换
 *
 * 播放、暂停、切歌、跳转、权限、投票、房间同步等逻辑全部位于
 * `usePlayer` / `useHowl` / `usePlayerSync`，本组件不参与，
 * 因此切换舞台不会影响房间权威状态或播放进度。
 */
export function AudioPlayer(props: AudioPlayerProps) {
  const { view, onToggleView } = props

  const setVisualStage = useSettingsStore((s) => s.setVisualStage)
  const { disabled: visualDisabled, effectiveVisualStage } = useVisualStageSupport()
  const visualQuality = useSettingsStore((s) => s.visualQuality)

  // WebGL 上下文丢失或不可用时，回退到经典播放器。
  // 直接改持久化的舞台设置，不额外维护本地标志位，避免多一份状态需要同步。
  const handleUnavailable = useCallback(() => {
    setVisualStage('classic')
  }, [setVisualStage])
  const quality: VisualQuality = useMemo(
    () => (visualQuality === 'auto' ? detectDefaultQuality() : visualQuality),
    [visualQuality],
  )

  /**
   * ★ 本设备实际渲染的舞台由 `useVisualStageSupport` 给出，**不是**直接读
   *   `visualStage`：触摸设备（移动端）上层已把 `visualStage` 归为 classic
   *   并把持久化值回写，因此这里两个来源是一致的。
   *
   *   为什么用 hook 的返回值而不是再读一次 store：这个组件在 `visualStage`
   *   被上层回写的**同一个提交**里重渲染时，store 值已是 'classic'，但
   *   `VisualModeMenu` 的高亮若依赖 store 会在回写的 effect 之前闪一帧
   *   "已选 Emily"。用 hook 的推导值可让菜单高亮、渲染分支、`stageKey`
   *   三者来自同一个数，不会分叉。
   */
  const visualStage = effectiveVisualStage
  const isMineradio = visualStage !== 'classic' && isVisualStageId(visualStage)
  const stageMode: StageMode = isMineradio ? visualStage : 'classic'

  /**
   * 菜单选择适配器。
   *
   * `VisualModeMenu` 的 `StageMode` 由 `VISUAL_MODES` 推导，而持久化层用
   * `VISUAL_STAGES` 白名单校验。两者集合相同但类型来源不同，这里显式收窄，
   * 避免任一侧新增模式时出现「能选但存不下」的静默失败。
   */
  const handleSelectStage = useCallback(
    (next: StageMode) => {
      // ★ 移动端（触摸设备）**没有**视觉舞台入口，这里也必须拒绝写入。
      //   菜单本身已不渲染，但 `AppearanceSection` 的「播放器模式」下拉仍在
      //   同一份 store 上，且两处共享 `setVisualStage` —— 只藏菜单不拦写入，
      //   会让设置面板成为绕过入口限制的后门（选了 → 存储变 emily → 回写
      //   effect 再把它改回 classic，表现为"选了没反应"）。这里显式早退，
      //   让"不可用"的语义在所有入口一致。
      if (visualDisabled) return
      setVisualStage(next)
      // ★ 视觉舞台只在 `view === 'player'` 时渲染（整页播放列表是经典舞台
      //   独有的概念）。若用户当前停在经典舞台的整页歌单里再选视觉模式，
      //   而这里不把视图切回来，渲染的仍是经典舞台 —— 菜单里视觉模式显示
      //   已选中、画面却不变，看起来像"舞台切换坏了"。
      //
      //   用既有的 toggle 回调切回播放器视图（从 playlist 切换必然回到
      //   player），避免为此新增一个 prop 或改动上层状态所有权。
      if (next !== 'classic' && view !== 'player') onToggleView()
    },
    [setVisualStage, view, onToggleView, visualDisabled],
  )

  const stageProps = {
    onPlay: props.onPlay,
    onPause: props.onPause,
    onSeek: props.onSeek,
    onLyricSeek: props.onLyricSeek,
    onNext: props.onNext,
    onPrev: props.onPrev,
    onOpenChat: props.onOpenChat,
    onOpenQueue: props.onOpenQueue,
    chatUnreadCount: props.chatUnreadCount,
    activeVote: props.activeVote,
    onCastVote: props.onCastVote,
    onStartVote: props.onStartVote,
  } as const

  return (
    <div className="relative h-full">
      {/* 舞台切换菜单。
          经典舞台自带的歌单切换按钮位于右上角，这里把菜单放在它的左侧，
          避免两个按钮重叠，同时保留相同的安全边距处理。

          ★ 移动端（触摸设备）**整个容器不渲染**。
            这里是把条件写在容器外、连空壳一起省掉，而不是在容器内藏按钮：
            `.mt-mineradio-mode-menu` 的定位只有 `top`/`right`（无宽高），
            容器本身在空置时是 0×0、不会挡指针，所以两种写法**都不会**
            挡住经典舞台的按钮 —— 选前者只是少留一层无意义的 DOM 与一个
            绝对定位层。见 `lib/visualStageSupport.ts`。 */}
      {!visualDisabled && (
        <div className="mt-mineradio-mode-menu absolute top-4 z-30">
          <VisualModeMenu mode={stageMode} onSelect={handleSelectStage} />
        </div>
      )}

      {isMineradio && view === 'player' ? (
        <StageErrorBoundary stageKey={visualStage} onUnavailable={handleUnavailable}>
          <Suspense fallback={<MineradioFallback />}>
            <MineradioPlayerStage
              {...stageProps}
              mode={visualStage}
              quality={quality}
              onUnavailable={handleUnavailable}
            />
          </Suspense>
        </StageErrorBoundary>
      ) : (
        <ClassicPlayerStage {...stageProps} view={view} onToggleView={onToggleView} />
      )}
    </div>
  )
}

/** 舞台加载中的占位：保持深色底，避免白闪 */
function MineradioFallback() {
  return <div className="absolute inset-0 bg-[#05070b]" aria-hidden="true" />
}
