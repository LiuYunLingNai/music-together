import type { FoliaModeId } from './foliaModes'

export type FoliaControl = {
  key: string
  label: string
  min?: number
  max?: number
  step?: number
  options?: readonly { value: string; label: string }[]
}
const range = (key: string, label: string, min = 0, max = 2, step = 0.05): FoliaControl => ({
  key,
  label,
  min,
  max,
  step,
})
const toggle = (key: string, label: string): FoliaControl => ({ key, label })
const select = (key: string, label: string, values: readonly string[]): FoliaControl => ({
  key,
  label,
  options: values.map((value) => ({ value, label: value })),
})
export const FOLIA_MODE_CONTROLS: Record<FoliaModeId, readonly FoliaControl[]> = {
  luminous: [
    toggle('enableWordRotation', '词语旋转'),
    range('breathingFloatMultiplier', '呼吸漂浮'),
    range('wordSpacing', '词间距', 0, 2),
  ],
  cadenza: [
    range('fontScale', '构图字号', 0.5, 2),
    range('widthRatio', '构图宽度', 0.2, 1),
    range('motionAmount', '运动强度'),
    range('glowIntensity', '辉光'),
    range('beamIntensity', '光束'),
  ],
  partita: [
    toggle('showGuideLines', '显示引导线'),
    toggle('useSemanticLayout', '语义布局'),
    range('staggerMin', '最小错峰', 0, 200, 10),
    range('staggerMax', '最大错峰', 0, 400, 10),
  ],
  fume: [
    toggle('hidePrintSymbols', '隐藏印刷符号'),
    toggle('disableGeometricBackground', '隐藏几何图形'),
    range('backgroundObjectOpacity', '图形透明度', 0, 1),
    range('textHoldRatio', '文字停留', 0.1, 2),
    select('cameraTrackingMode', '镜头跟随', ['stepped', 'smooth']),
    range('cameraSpeed', '镜头速度', 0.2, 3),
    range('glowIntensity', '辉光'),
    range('heroScale', '主文字比例', 0.5, 2),
  ],
  claddagh: [
    range('focusScaleRatio', '焦点比例', 0.3, 1),
    range('radiusScale', '歌词环半径', 0.5, 1.5),
    range('ellipseTiltDeg', '椭圆倾斜', 0, 90, 1),
    toggle('showAxisLine', '显示轴线'),
    range('letterSpacingOffset', '字间距', -10, 20, 1),
  ],
  cappella: [toggle('showEmoMessages', '表情回复'), select('avatarSource', '头像来源', ['cover', 'builtin', 'color'])],
  tilt: [
    range('splitProbability', '切句概率', 0, 1),
    range('tiltStyleProbability', '倾斜概率', 0, 1),
    select('colorScheme', '文字配色', ['default', 'swap', 'accentAll', 'primaryAll']),
  ],
  monet: [
    toggle('keywordColoringEnabled', '关键词配色'),
    toggle('showDescription', '歌曲描述'),
    toggle('showAudioVisualization', '音频可视化'),
    select('audioStyle', '频谱形状', ['bar', 'line']),
    range('fontScale', '海报字号', 0.5, 2),
    select('portraitStyle', '封面形状', ['square', 'rectangular']),
  ],
  pendolo: [
    range('arcRadius', '圆弧半径', 0.2, 0.8),
    range('arcAngleDeg', '圆弧角度', 30, 180, 1),
    range('tickSnappiness', '机械回弹', 0.1, 5),
    range('activeScale', '当前行比例', 1, 2),
    select('showGearDecor', '齿轮装饰', ['none', 'subtle', 'full']),
    toggle('showCenterGradient', '中心渐变'),
    toggle('showCoverOnWatchFace', '表盘封面'),
    toggle('enableLineGlow', '歌词辉光'),
  ],
  sonnet: [
    range('cameraIntensity', '镜头运动'),
    range('typographyMotion', '文字运动'),
    range('mgDensity', '图形密度'),
    toggle('showOnlyText', '只显示文字'),
    toggle('showGuide', '显示引导'),
    toggle('showBackgroundMg', '背景图形'),
    toggle('showFixedGeo', '固定图形'),
    toggle('showGiantDecorativeText', '大字装饰'),
    toggle('showBackgroundDecor', '背景装饰'),
    toggle('enableTransitions', '场景转场'),
    select('outerFrameMode', '外框', ['none', 'frame', 'full']),
    range('textureResolution', '纹理精度', 0.5, 1.5),
    toggle('postProcessEnabled', '后期处理'),
    range('postProcessGrain', '颗粒', 0, 1),
    range('postProcessContrast', '对比度', 0, 1),
    range('postProcessVignette', '暗角'),
  ],
  tempera: [
    range('cameraIntensity', '镜头运动'),
    range('glyphMotion', '字符运动'),
    toggle('wholeLineLyrics', '整行歌词'),
    range('glyphSettleStretch', '入场时序', 0, 1),
    select('colorMode', '配色', ['duo', 'mono', 'gradient']),
    toggle('showBlocks', '色块场景'),
    toggle('showDecor', '装饰元素'),
    toggle('showCornerMarks', '边角线框'),
    toggle('textInversion', '动态反色'),
    toggle('enableTransitions', '场景转场'),
    range('textureResolution', '纹理精度', 0.5, 1.5),
  ],
  lumiere: [
    range('lightIntensity', '光照强度', 0.3, 2),
    range('audioResponse', '音频响应'),
    range('bloom', '泛光'),
    range('textBloom', '文字泛光'),
    range('darkField', '暗场', 0, 1),
    range('fogDensity', '雾密度'),
    range('moteAmount', '浮尘数量'),
    toggle('frontBokeh', '前景散景'),
    toggle('lineArt', '线稿'),
    toggle('overlayFrame', '叠层边框'),
    toggle('textOnly', '只显示文字'),
    toggle('seamlessTransitions', '连续转场'),
    range('themeColorMix', '主题混色', 0, 1),
  ],
  diorama: [
    range('cameraSpeed', '镜头速度', 0.2, 3),
    range('motionAmount', '镜头运动'),
    range('audioReactivity', '音频响应'),
    range('particleDensity', '粒子密度', 0.1, 2),
    toggle('showParticles', '粒子'),
    toggle('particleGlowEnabled', '粒子辉光'),
    range('particleGlowIntensity', '辉光强度'),
    toggle('glowEnabled', '辉光跟唱'),
    toggle('soulEnabled', '文字漂移'),
    toggle('gradientEnabled', '渐变跟唱'),
  ],
  still: [],
}

export function validateControl(control: FoliaControl, value: unknown): unknown {
  if (control.options) return control.options.some((item) => item.value === value) ? value : undefined
  if (control.min !== undefined && control.max !== undefined)
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(control.min, Math.min(control.max, value))
      : undefined
  return typeof value === 'boolean' ? value : undefined
}
