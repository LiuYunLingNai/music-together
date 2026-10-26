import { FoliaRenderer } from '../../../FoliaRenderer'
import { FOLIA_MODE_RENDERERS } from '../../../renderers'
import { useFoliaAudioSignals } from '../../../stage/foliaAudioContext'
import { getFoliaTuningProps } from '../../../stage/foliaTunings'
import type { VisualizerSharedProps } from './definition'
import type { FoliaModeId } from '../../../registry'

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
    hanabi: 'hanabi', diorama: 'diorama', still: 'still',
}

export type WindowRendererProps = Omit<VisualizerSharedProps, 'theme'> & {
    mode: string
    theme?: VisualizerSharedProps['theme']
    animateStyleSwitch?: boolean
    visualizerTunings?: unknown
    onVisualizerTuningChange?: (patch: object) => void
}

export default function WindowRenderer({ mode, visualizerTunings, onVisualizerTuningChange, ...props }: WindowRendererProps) {
    // 窗口把整包调参挂在 props 上；宿主按模式解析调参（与播放页同一套 tuning props）。
    void visualizerTunings
    void onVisualizerTuningChange
    const hostMode = HOST_MODE_BY_UPSTREAM[mode] ?? 'luminous'
    const audio = useFoliaAudioSignals()
    const Style = FOLIA_MODE_RENDERERS[hostMode]
    // 上游的样例舞台与缩略图都只该画样式本身：窗口里没有一处需要真实背景层
    // （背景的整体观感由「背景」页的缩略图画廊自己表现）。早期版本只在小图透明时
    // 才跳过背景，样例舞台仍在跑 geometric 背景动画。
    const styleOnly = true
    const sharedProps = {
        ...(props as unknown as VisualizerSharedProps),
        ...(audio ?? {}),
    }
    return (
        <FoliaRenderer
            {...sharedProps}
            mode={hostMode}
            renderers={FOLIA_MODE_RENDERERS}
            // 小图与样例舞台不画背景：直接渲染样式本身，和上游 `render()` 的用法一致。
            renderStyleOnly={styleOnly ? Style : undefined}
            tuningsFor={(styleMode) => getFoliaTuningProps(styleMode, {
                fontScale: 1,
                tunings: {},
            } as never)}
        />
    )
}
