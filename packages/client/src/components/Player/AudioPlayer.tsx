import { Component, Suspense, lazy, useCallback, useMemo, type ReactNode } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VoteAction, VoteState } from '@music-together/shared'
import { useVisualStageSupport } from '@/hooks/useVisualStageSupport'
import { ClassicPlayerStage } from './classic/ClassicPlayerStage'
import { StageSwitcher } from './stages/StageSwitcher'
import type { StageMode } from './stages/registry'
import { detectDefaultQuality, type VisualQuality } from './stages/RenderPolicy'
import type { VisualModeId } from './stages/VisualMode'
import type { FoliaModeId } from './folia/registry'
import { resolveStageFamily } from './stages/registry'
import { isFoliaModeId } from './folia/registry'

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
 * Folia 舞台按需加载。
 *
 * 与 mineradio 同理：`motion/react` 与全部歌词布局/模式代码只在用户切到
 * folia 模式时才请求。`folia/renderers.ts` 内部再对五个模式各自 lazy ——
 * cappella 带约 3.5 MB 头像/表情 PNG，单独成块尤其重要。
 */
const FoliaPlayerStage = lazy(() =>
  import('./folia/FoliaPlayerStage').then((m) => ({ default: m.FoliaPlayerStage })),
)
// 歌词样式工作窗口：同样惰性加载，且只在打开时挂载（图标与套件不进首屏包）。
const FoliaStyleWindowHost = lazy(() =>
  import('./folia/FoliaStyleWindow').then((m) => ({ default: m.FoliaStyleWindowHost })),
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
  /** 播放列表浮层的开关状态（folia 舞台把抽屉替换为播放栏浮岛时渲染它）。 */
  queueOpen?: boolean
  onQueueOpenChange?: (open: boolean) => void
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
  const setFoliaSettings = useSettingsStore((s) => s.setFoliaSettings)
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
   *   `StageSwitcher` 的高亮若依赖 store 会在回写的 effect 之前闪一帧
   *   "已选 Emily"。用 hook 的推导值可让菜单高亮、渲染分支、`stageKey`
   *   三者来自同一个数，不会分叉。
   */
  const visualStage = effectiveVisualStage
  /**
   * 舞台族路由。
   *
   * `resolveStageFamily` 同时回答"是不是视觉舞台"和"属于哪一族"：
   * mineradio（three.js 粒子）与 folia（DOM/CSS 歌词）是并列的两族，
   * 各有自己的懒加载宿主。未知 id 返回 null → 走经典分支（安全回退）。
   *
   * ★ 这里**不再**用 `isVisualStageId`（只看 mineradio）—— 否则 folia 的
   *   模式会被判成非视觉舞台，直接渲染经典播放器，表现为"选了没反应"。
   */
  const stageFamily = resolveStageFamily(visualStage)
  const isVisualStage = stageFamily !== null
  const stageMode: StageMode = isVisualStage ? (visualStage as StageMode) : 'classic'

  /**
   * 菜单选择适配器。
   *
   * `StageSwitcher` 的 `StageMode` 由两族注册表（`FOLIA_MODES` +
   * `VISUAL_MODES`）推导，而持久化层用 `VISUAL_STAGES` 白名单校验。两者集合
   * 相同但类型来源不同，这里显式收窄，避免任一侧新增模式时出现
   * 「能选但存不下」的静默失败。
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
      // 手动选具体样式即关掉「每首随机」（上游 handleSetVisualizerMode 的语义），
      // 否则下一次切歌会立刻把刚选的样式换掉。
      if (isFoliaModeId(next)) setFoliaSettings({ lyricMode: next, randomMode: false })
      // ★ 视觉舞台只在 `view === 'player'` 时渲染（整页播放列表是经典舞台
      //   独有的概念）。若用户当前停在经典舞台的整页歌单里再选视觉模式，
      //   而这里不把视图切回来，渲染的仍是经典舞台 —— 菜单里视觉模式显示
      //   已选中、画面却不变，看起来像"舞台切换坏了"。
      //
      //   用既有的 toggle 回调切回播放器视图（从 playlist 切换必然回到
      //   player），避免为此新增一个 prop 或改动上层状态所有权。
      if (next !== 'classic' && view !== 'player') onToggleView()
    },
    [setVisualStage, setFoliaSettings, view, onToggleView, visualDisabled],
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
      {/* 歌词样式工作窗口挂在这里而不是舞台内部：舞台在 `visualStage` 变化时整棵重渲染，
          窗口若挂在里面，切样式就会跟着闪退重进一次。窗口的开关在 store 里，未打开时不挂载。 */}
      <Suspense fallback={null}>
        <FoliaStyleWindowHost />
      </Suspense>
      {/* 舞台切换器：三段胶囊（经典 | 3D | Folia），点已激活段展开该族模式列表。
          位于经典舞台歌单按钮的左侧，避免两个按钮重叠，保留相同的安全边距处理。

          ★ 移动端（触摸设备）**整个容器不渲染**。
            这里是把条件写在容器外、连空壳一起省掉，而不是在容器内藏按钮：
            `.mt-mineradio-mode-menu` 的定位只有 `top`/`right`（无宽高），
            容器本身在空置时是 0×0、不会挡指针，所以两种写法**都不会**
            挡住经典舞台的按钮 —— 选前者只是少留一层无意义的 DOM 与一个
            绝对定位层。见 `lib/visualStageSupport.ts`。 */}
      {!visualDisabled && (
        <div className="mt-mineradio-mode-menu absolute top-4 z-30 flex items-center">
          <StageSwitcher mode={stageMode} onSelect={handleSelectStage} />
        </div>
      )}

      {isVisualStage && view === 'player' ? (
        /* 视觉舞台只在播放器视图渲染：整页歌单是经典舞台独有的概念。
           两族共用同一个错误边界与回退语义 —— 任何一族在挂载期抛错
           （chunk 加载失败 / WebGL 上下文创建失败）都会把持久化舞台
           回写为 classic，播放本身不受影响（播放所有权在舞台之外）。 */
        <StageErrorBoundary stageKey={visualStage} onUnavailable={handleUnavailable}>
          <Suspense fallback={<StageFallback />}>
            {stageFamily === 'folia' ? (
              <FoliaPlayerStage
                {...stageProps}
                mode={visualStage as FoliaModeId}
                queueOpen={props.queueOpen}
                onQueueOpenChange={props.onQueueOpenChange}
              />
            ) : (
              <MineradioPlayerStage
                {...stageProps}
                mode={visualStage as VisualModeId}
                quality={quality}
                onUnavailable={handleUnavailable}
              />
            )}
          </Suspense>
        </StageErrorBoundary>
      ) : (
        <ClassicPlayerStage {...stageProps} view={view} onToggleView={onToggleView} />
      )}
    </div>
  )
}

/** 舞台加载中的占位：保持深色底，避免白闪 */
function StageFallback() {
  return <div className="absolute inset-0 bg-[#05070b]" aria-hidden="true" />
}
