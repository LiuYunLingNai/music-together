import { FoliaRenderer } from '../../../FoliaRenderer'
import { FOLIA_MODE_RENDERERS } from '../../../renderers'
import { getFoliaTuningProps } from '../../../stage/foliaTunings'
import type { VisualizerSharedProps } from './definition'
import type { FoliaModeId } from '../../../registry'
import type { VisualizerTuningBundle } from './tuningRegistry'

/**
 * 上游 `VisualizerRenderer.tsx` 的宿主版本。
 *
 * 上游这一层画「背景层 + 模式层 + 过渡 + 和声叠层」，宿主已由 `FoliaRenderer` 实现。
 * 但窗口里的小图与样例舞台**只要样式本身**：上游 `LyricStylePicture` 传的是
 * `background: { transparent: true }`，`VisPlaygroundSampleStage` 只把样式放进自己的框。
 * 因此这里按 `background.transparent` 决定是否连背景层一起画 —— 早期版本无条件画背景，
 * 结果 16 张缩略图各自起了一套几何背景动画（实测窗口内 43 个常驻 CSS 动画，帧率从
 * 85 fps 掉到 10 fps）。
 */
const HOST_MODE_BY_UPSTREAM: Record<string, FoliaModeId> = {
    classic: 'luminous', cadenza: 'cadenza', partita: 'partita', fume: 'fume',
    claddagh: 'claddagh', cappella: 'cappella', tilt: 'tilt', monet: 'monet',
    pendolo: 'pendolo', sonnet: 'sonnet', tempera: 'tempera', lumiere: 'lumiere',
    hanabi: 'hanabi', diorama: 'diorama', still: 'still', machi: 'machi', nebbia: 'nebbia',
}

/** 上游调参包按上游模式名索引，渲染器读的是宿主 prop 名（与 tuningRegistry 的 apply 一致）。 */
const tuningProps = (mode: string, bundle: VisualizerTuningBundle | undefined) => {
    const tuning = (bundle as Record<string, unknown> | undefined)?.[mode]
    return tuning === undefined ? undefined : { [mode === 'classic' ? 'classicTuning' : `${mode}Tuning`]: tuning }
}

export type WindowRendererProps = Omit<VisualizerSharedProps, 'theme'> & {
    mode: string
    theme?: VisualizerSharedProps['theme']
    animateStyleSwitch?: boolean
    visualizerTunings?: VisualizerTuningBundle
    onVisualizerTuningChange?: (patch: object) => void
}

export default function WindowRenderer({ mode, visualizerTunings, onVisualizerTuningChange, ...props }: WindowRendererProps) {
    // 窗口把整包调参挂在 props 上（上游 `applyVisualizerTuning(shownMode, …)`）：
    // 样例舞台要按当前调参（含滑块草稿）重画，否则调什么都不会变。
    const hostMode = HOST_MODE_BY_UPSTREAM[mode] ?? 'luminous'
    // 画面里直接拖动调参（莫奈封面、回环环线等）经这些 prop 回传，宿主写回同一份草稿。
    const tuningChangeProps = onVisualizerTuningChange
        ? {
            onMonetTuningChange: onVisualizerTuningChange,
            onCladdaghTuningChange: onVisualizerTuningChange,
            onPendoloTuningChange: onVisualizerTuningChange,
            onSonnetTuningChange: onVisualizerTuningChange,
            onTemperaTuningChange: onVisualizerTuningChange,
            onLumiereTuningChange: onVisualizerTuningChange,
            onHanabiTuningChange: onVisualizerTuningChange,
            onMachiTuningChange: onVisualizerTuningChange,
        }
        : {}
    // 上游的样例舞台与缩略图都只该画样式本身：窗口里没有一处需要真实背景层
    // （背景的整体观感由「背景」页的缩略图画廊自己表现）。早期版本只在小图透明时
    // 才跳过背景，样例舞台仍在跑 geometric 背景动画。
    const styleOnly = true
    const shownTuning = tuningProps(mode, visualizerTunings)
        ?? getFoliaTuningProps(hostMode, { fontScale: 1, tunings: {} } as never)
    const sharedProps = {
        ...(props as unknown as VisualizerSharedProps),
        ...tuningChangeProps,
        ...shownTuning,
    }
    return (
        <FoliaRenderer
            {...sharedProps}
            mode={hostMode}
            renderers={FOLIA_MODE_RENDERERS}
            // 小图与样例舞台不画背景：直接渲染样式本身，和上游 `render()` 的用法一致。
            renderStyleOnly={styleOnly}
            // 切换模式时还在退场的旧样式要用它自己的调参。
            tuningsFor={(styleMode) => tuningProps(styleMode, visualizerTunings) ?? {}}
        />
    )
}
