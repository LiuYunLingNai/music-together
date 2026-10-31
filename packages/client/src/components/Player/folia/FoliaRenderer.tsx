import { Suspense, useDeferredValue, useLayoutEffect, useMemo, type ComponentType } from 'react'
import type { FoliaSharedProps } from './definition'
import type { FoliaModeId } from './registry'
import type { VisualizerBackgroundConfig } from './upstream/components/visualizer/backgrounds/definition'
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from './upstream/components/visualizer/backgrounds/registry'
import './upstream/components/visualizer/backgrounds/entries'
import VisualizerBackdrop, { VisualizerBackdropContext } from './upstream/components/visualizer/VisualizerBackdrop'
import VisualizerStyleTransition, {
  useStyleSwitch,
} from './upstream/components/visualizer/styleTransition/VisualizerStyleTransition'
import softFocus from './upstream/components/visualizer/styleTransition/softFocus'
import { alongProgress } from './upstream/components/visualizer/styleTransition/layerTransition'
import { holdTurns } from './upstream/components/visualizer/preview/pictureTurns'
import { useHandoffCover } from './upstream/components/visualizer/useHandoffCover'
import { useReducedMotionFor } from './upstream/hooks/useReducedMotionFor'
import { fumeBackgroundConfig } from './upstream/components/visualizer/fume/backgroundConfig'
import VisualizerHarmonyOverlay from './upstream/components/visualizer/VisualizerHarmonyOverlay'

/**
 * 舞台画布的宿主适配层 —— 对应上游 `VisualizerRenderer.tsx`。
 *
 * 上游把「样式层」与「背景层」拆成两个可以各自过渡的层：
 *
 *   `VisualizerRenderer`（延迟到模式代码就绪）
 *     └ `VisualizerBackdrop`（背景层，换背景/换歌时柔焦交叉）
 *         └ `VisualizerStyleTransition`（模式层，切换模式时柔焦交叉）
 *
 * 本项目此前是在 `FoliaPlayerStage` 里把背景与模式**并排**组合，两者都不参与
 * 过渡；这里改成与上游同一棵树。
 *
 * ★ 与上游的差异只有宿主侧的两处：
 *   ① 没有 `applyVisualizerTuning` 一层：本项目的调参由宿主在 `foliaTunings` 里解析好后
 *      以 props 传进来；`FoliaRenderer` 只额外保证「退场中的旧模式拿到它自己的调参」
 *      （上游对 `styleMode !== shownMode` 也会用那个模式的 tuning 重新解析）。
 *   ② 没有 `VideoLayer` / folium mod 舞台层（见 `VisualizerBackdrop.tsx`）。
 */

/**
 * 各模式调参在 `FoliaSharedProps` 上的字段名（`getFoliaTuningProps` 的产物）。
 * 切换模式时先把它们摘掉，再放上**那个**模式的调参。
 */
/** 只画样式时给 shell 的占位 frame：没有指针区域，也表明「背景已由外层处理」。 */
const STYLE_ONLY_FRAME = { pointerArea: null }

const FOLIA_TUNING_PROP_KEYS = [
  'classicTuning',
  'cadenzaTuning',
  'partitaTuning',
  'fumeTuning',
  'claddaghTuning',
  'cappellaTuning',
  'tiltTuning',
  'monetTuning',
  'dioramaTuning',
  'pendoloTuning',
  'sonnetTuning',
  'temperaTuning',
  'lumiereTuning',
  'hanabiTuning',
] as const satisfies readonly (keyof FoliaSharedProps)[]

/** 模式自己指定的背景（上游各 `entry.tsx` 的 `background` 字段）。 */
export type FoliaModeBackground =
  | false
  | ((props: FoliaSharedProps) => VisualizerBackgroundConfig | undefined)

const MODE_BACKGROUNDS: Partial<Record<FoliaModeId, FoliaModeBackground>> = {
  fume: fumeBackgroundConfig,
  still: false,
}

/** 摘掉所有模式调参，再放上这一个模式的（上游按模式重新解析调参的等价物）。 */
const withTuning = (
  props: FoliaSharedProps,
  tuning: Partial<FoliaSharedProps> | undefined,
): FoliaSharedProps => {
  const next = { ...props }
  for (const key of FOLIA_TUNING_PROP_KEYS) delete next[key]
  return { ...next, ...tuning }
}

interface FoliaRendererProps extends FoliaSharedProps {
  mode: FoliaModeId
  renderers: Record<FoliaModeId, ComponentType<FoliaSharedProps>>
  /**
   * 某个模式自己的调参（本项目的 `getFoliaTuningProps`）。
   *
   * 上游 `applyVisualizerTuning(styleMode, …)` 会给**每一个正在画的模式**解析它自己的调参，
   * 包括切换时还在退场的旧模式；本项目的调参是宿主算好后以 props 传进来的，所以这里要能
   * 回头为旧模式重新取一次。不传时退场样式沿用当前 props（旧行为）。
   */
  tuningsFor?: (mode: FoliaModeId) => Partial<FoliaSharedProps>
  /** 只在用户手动切换模式时播放过渡（上游 `animateStyleSwitch`）。 */
  animateStyleSwitch?: boolean
  /** 背景上方、歌词下方的一层压暗（本项目的宿主扩展，上游没有）。 */
  backgroundDim?: number
  /**
   * 只画这一个样式，不画背景层（上游 `VisualizerRenderer` 的调用方在预览里传
   * `background.transparent`，小图只该有样式）。给了它就不挂 `VisualizerBackdrop`。
   */
  renderStyleOnly?: ComponentType<FoliaSharedProps>
}

export function FoliaRenderer({
  mode,
  renderers,
  tuningsFor,
  animateStyleSwitch = false,
  backgroundDim = 0,
  renderStyleOnly,
  ...props
}: FoliaRendererProps) {
  // 模式代码按需到达：屏幕上显示的模式要等它的 chunk 到了才换，
  // 在此之前旧模式继续画（与上游 `useDeferredValue` 同一语义）。
  const shownMode = useDeferredValue(mode)
  const background = MODE_BACKGROUNDS[shownMode]
  const resolvedBackground = useMemo(
    () => ({
      ...props.background,
      mode: props.background?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE,
    }),
    [props.background],
  )
  const sharedProps: FoliaSharedProps = { ...props, background: resolvedBackground }
  // 静态模式（含系统的减弱动效偏好）下直接硬切，与上游一致。
  // 上游还看了自己的「界面微动效」设置（`useReducedMotionFor('uiMicroMotion')`）；
  // 本项目没有那份设置，宿主版 hook 只认系统偏好。
  const reducedMotion = useReducedMotionFor()
  const transition = animateStyleSwitch && !sharedProps.staticMode && !reducedMotion ? softFocus : null
  // A blend's song hand-off, for the style that draws one (VisualizerSongHandoff). The background takes
  // the incoming song (its cover, seed and theme) when the blend starts, and changes with the transition
  // of any song change, played along the hand-off: as long as the blend, in step with the song it hands
  // over to. At the settle its song is already that one, so nothing changes again. Where a switch cuts
  // there is no hand-off: the song changes at the settle, as everywhere else.
  const songHandoff = transition ? sharedProps.songHandoff ?? null : null
  const handoffProgress = songHandoff?.progress ?? null
  const backgroundTransition = useMemo(
    () => (transition && handoffProgress ? alongProgress(transition, handoffProgress) : transition),
    [transition, handoffProgress],
  )
  const styleProps: FoliaSharedProps = songHandoff || !sharedProps.songHandoff ? sharedProps : { ...sharedProps, songHandoff: null }
  const backdropCover = useHandoffCover(songHandoff, sharedProps.seed, sharedProps.coverUrl)
  const backdropProps = songHandoff
    ? { ...styleProps, coverUrl: backdropCover, seed: songHandoff.seed, theme: songHandoff.theme }
    : backdropCover === styleProps.coverUrl ? styleProps : { ...styleProps, coverUrl: backdropCover }
  const styleSwitch = useStyleSwitch(shownMode, transition)
  const switchAsked = transition !== null && mode !== shownMode
  // 从选中新模式到它挂上（代码可能还在路上）之间，也不让小的预览图开始绘制。
  useLayoutEffect(() => (switchAsked ? holdTurns() : undefined), [switchAsked])

  const darken = useMemo(
    () => (backgroundDim > 0 ? { opacity: backgroundDim } : null),
    [backgroundDim],
  )

  // 只画样式（设置窗口的小图 / 样例舞台）：没有背景层，也没有背景过渡。
  if (renderStyleOnly) {
    const Style = renderStyleOnly
    // 关键：`VisualizerShell` 在自己的 `VisualizerBackdropContext` 为 null 时会**自己再画一层背景**
    // （上游永远把它放在 backdrop 里，所以那段代码在播放页不会执行）。预览只画样式时必须给出这个
    // context，否则每个缩略图都会多起一套几何背景动画 —— 实测窗口内 15 张图各一套，帧率腰斩。
    // 样式切换的过渡与和声叠层仍按上游挂上：预览里换样式同样要柔焦交叉。
    return (
      <VisualizerBackdropContext.Provider value={STYLE_ONLY_FRAME}>
        <Suspense fallback={null}>
          <VisualizerStyleTransition
            styleSwitch={styleSwitch}
            transition={transition}
            renderStyle={(styleMode) => (
              styleMode === shownMode || !tuningsFor
                ? <Style {...sharedProps} />
                : <Style {...withTuning(sharedProps, tuningsFor(styleMode as FoliaModeId))} />
            )}
          />
        </Suspense>
        <VisualizerHarmonyOverlay
          currentTime={sharedProps.currentTime}
          lines={sharedProps.lines}
          showText={sharedProps.showText ?? true}
          theme={sharedProps.theme}
          subtitleTheme={sharedProps.subtitleTheme}
          isPlayerChromeHidden={sharedProps.isPlayerChromeHidden}
          hideTranslationSubtitle={sharedProps.hideTranslationSubtitle}
          showSubtitleTranslation={sharedProps.showSubtitleTranslation}
          subtitleContentMode={sharedProps.subtitleContentMode}
          showHarmonySubtitle={sharedProps.showHarmonySubtitle}
          harmonySubtitleBackground={sharedProps.harmonySubtitleBackground}
          subtitleFontScale={sharedProps.subtitleFontScale}
        />
      </VisualizerBackdropContext.Provider>
    )
  }

  return (
    <>
      <Suspense fallback={null}>
        <VisualizerBackdrop
          background={background}
          props={backdropProps}
          transition={backgroundTransition}
          waits={styleSwitch.waits}
        >
          {darken && <div aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-black" style={darken} />}
          <VisualizerStyleTransition
            styleSwitch={styleSwitch}
            transition={transition}
            renderStyle={(styleMode) => {
              const Renderer = renderers[styleMode as FoliaModeId]
              if (!Renderer) return null
              // 上游：`styleMode === shownMode ? resolvedProps : applyVisualizerTuning(styleMode, …)`。
              // 退场中的旧模式拿它自己的调参，否则切换时旧样式会突然换成新样式的字号/布局。
              if (styleMode === shownMode || !tuningsFor) return <Renderer {...styleProps} />
              return <Renderer {...withTuning(styleProps, tuningsFor(styleMode as FoliaModeId))} />
            }}
          />
        </VisualizerBackdrop>
      </Suspense>
      {/* 上游 `VisualizerRenderer` 把和声叠层挂在 Suspense 之外：它不属于样式层，
          换样式时不参与柔焦过渡，也不随背景层重挂。 */}
      <VisualizerHarmonyOverlay
        currentTime={sharedProps.currentTime}
        lines={sharedProps.lines}
        showText={sharedProps.showText ?? true}
        theme={sharedProps.theme}
        subtitleTheme={sharedProps.subtitleTheme}
        isPlayerChromeHidden={sharedProps.isPlayerChromeHidden}
        hideTranslationSubtitle={sharedProps.hideTranslationSubtitle}
        showSubtitleTranslation={sharedProps.showSubtitleTranslation}
        subtitleContentMode={sharedProps.subtitleContentMode}
        showHarmonySubtitle={sharedProps.showHarmonySubtitle}
        harmonySubtitleBackground={sharedProps.harmonySubtitleBackground}
        subtitleFontScale={sharedProps.subtitleFontScale}
      />
    </>
  )
}
