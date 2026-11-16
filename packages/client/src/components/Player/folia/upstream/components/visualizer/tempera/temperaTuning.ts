import {
    DEFAULT_TEMPERA_LAYER_IMAGE,
    DEFAULT_TEMPERA_TUNING,
    TEMPERA_MAX_LAYER_IMAGES,
    type TemperaLayerImage,
    type TemperaTuning,
} from '../../../types'
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality'
import { numberWithin } from '../tuningDefinition'

// 凝彩 tuning 的归一化（上游 `tempera/tuning.ts` 的 resolve / sanitizeLayerImages）。
// 宿主用声明式控件表表达不了 `layerImages` 这类对象数组，所以这一个模式走整体归一化。

const switchOr = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** 图层图的位置记录来自存档 / 同步 / 粘贴的外观码，每个字段都夹紧，坏值不会把图丢到屏幕外。 */
const sanitizeLayerImages = (value: unknown): TemperaLayerImage[] => {
    if (!Array.isArray(value)) return []
    return value.flatMap<TemperaLayerImage>((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const record = entry as Partial<TemperaLayerImage>
        if (typeof record.id !== 'string' || !record.id) return []
        const align = record.align
        const verticalAlign = record.verticalAlign
        return [{
            id: record.id,
            name: typeof record.name === 'string' ? record.name : record.id,
            align: align === 'left' || align === 'center' || align === 'right' || align === 'free'
                ? align
                : DEFAULT_TEMPERA_LAYER_IMAGE.align,
            verticalAlign: verticalAlign === 'top'
                || verticalAlign === 'center'
                || verticalAlign === 'bottom'
                || verticalAlign === 'free'
                ? verticalAlign
                : DEFAULT_TEMPERA_LAYER_IMAGE.verticalAlign,
            scale: numberWithin(record.scale, DEFAULT_TEMPERA_LAYER_IMAGE.scale, 0.05, 2),
            opacity: numberWithin(record.opacity, DEFAULT_TEMPERA_LAYER_IMAGE.opacity, 0, 1),
        }]
    }).slice(0, TEMPERA_MAX_LAYER_IMAGES)
}

/** `values` 要的 tuning，缺的 / 类型不对的用 `base`，数值夹进范围。 */
const resolve = (values: Partial<TemperaTuning>, base: TemperaTuning): TemperaTuning => ({
    render: normalizeLyricRenderOverride({ ...base.render, ...(values.render ?? {}) }),
    cameraIntensity: numberWithin(values.cameraIntensity, base.cameraIntensity, 0, 2),
    glyphMotion: numberWithin(values.glyphMotion, base.glyphMotion, 0, 2),
    wholeLineLyrics: switchOr(values.wholeLineLyrics, base.wholeLineLyrics),
    glyphSettleStretch: numberWithin(values.glyphSettleStretch, base.glyphSettleStretch, 0, 1),
    depthOfField: numberWithin(values.depthOfField, base.depthOfField, 0, 2),
    depthPan: numberWithin(values.depthPan, base.depthPan, 0, 2),
    glyphDepth: numberWithin(values.glyphDepth, base.glyphDepth, 0, 2),
    colorMode: values.colorMode === 'duo' || values.colorMode === 'mono' || values.colorMode === 'gradient' ? values.colorMode : base.colorMode,
    textInversion: switchOr(values.textInversion, base.textInversion),
    // 默认值里的数组 / 对象要做一份拷贝：归一化结果会被渲染器长期持有，
    // 不能和 `DEFAULT_TEMPERA_TUNING` 共享引用。
    layerImages: values.layerImages ? sanitizeLayerImages(values.layerImages) : base.layerImages.map((image) => ({ ...image })),
    layerImageDepth: values.layerImageDepth === 'front' || values.layerImageDepth === 'back' ? values.layerImageDepth : base.layerImageDepth,
    layerImageFrequency: numberWithin(values.layerImageFrequency, base.layerImageFrequency, 0, 1),
    showBlocks: switchOr(values.showBlocks, base.showBlocks),
    showDecor: switchOr(values.showDecor, base.showDecor),
    showCornerMarks: switchOr(values.showCornerMarks, base.showCornerMarks),
    enableTransitions: switchOr(values.enableTransitions, base.enableTransitions),
    textureResolution: numberWithin(values.textureResolution, base.textureResolution, 0.5, 4),
    postProcessEnabled: switchOr(values.postProcessEnabled, base.postProcessEnabled),
    postProcessTextureCompression: switchOr(values.postProcessTextureCompression, base.postProcessTextureCompression),
    postProcessGrain: numberWithin(values.postProcessGrain, base.postProcessGrain, 0, 1),
    postProcessContrast: numberWithin(values.postProcessContrast, base.postProcessContrast, 0, 1),
    postProcessRgbShift: numberWithin(values.postProcessRgbShift, base.postProcessRgbShift, 0, 1),
    postProcessVignette: numberWithin(values.postProcessVignette, base.postProcessVignette, 0, 2),
    postProcessLensDistortion: numberWithin(values.postProcessLensDistortion, base.postProcessLensDistortion, 0, 2),
})

/** 存档 / 导入 / 同步来的部分 tuning 读成一份完整合法的 tuning。 */
export const normalizeTemperaTuning = (stored: unknown): TemperaTuning =>
    resolve((stored && typeof stored === 'object' ? stored : {}) as Partial<TemperaTuning>, DEFAULT_TEMPERA_TUNING)
