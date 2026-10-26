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
    // 上游 settingsPanels 的经典排版切换：语义分块布局 ↔ 逐词原始排布。
    toggle('useLegacyLayout', '经典逐词排布'),
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
    // 上游 settingsPanels：stagger 两轴都 0-180 step 5（resolvePartitaTuning clamp 0-180）。
    range('staggerMin', '最小错峰', 0, 180, 5),
    range('staggerMax', '最大错峰', 0, 180, 5),
  ],
  fume: [
    toggle('hidePrintSymbols', '隐藏印刷符号'),
    toggle('disableGeometricBackground', '隐藏几何图形'),
    range('backgroundObjectOpacity', '图形透明度', 0, 1),
    // 上游 settingsPanels：textHoldRatio 0-1（面板显示为百分比）。
    range('textHoldRatio', '文字停留', 0, 1),
    select('cameraTrackingMode', '镜头跟随', ['stepped', 'smooth']),
    range('cameraSpeed', '镜头速度', 0.55, 1.85),
    range('glowIntensity', '辉光', 0, 1.8),
    range('heroScale', '主文字比例', 0.82, 1.32),
  ],
  claddagh: [
    // 上游 settingsPanels clampCladdagh*：focusScaleRatio 0-1.5、radiusScale 0.5-1.5、
    // ellipseTiltDeg 0-60、letterSpacingOffset -5..20 step 0.5。
    range('focusScaleRatio', '焦点比例', 0, 1.5),
    range('radiusScale', '歌词环半径', 0.5, 1.5),
    range('ellipseTiltDeg', '椭圆倾斜', 0, 60, 1),
    toggle('showAxisLine', '显示轴线'),
    range('letterSpacingOffset', '字间距', -5, 20, 0.5),
  ],
  cappella: [
    toggle('showEmoMessages', '表情回复'),
    // 上游 CappellaTuning.emojiPackSource：builtin | custom（custom = 用户导入的表情包）。
    select('emojiPackSource', '表情包来源', ['builtin', 'custom']),
    // 上游 CappellaTuning.avatarSource：cover | builtin | color | custom。
    select('avatarSource', '头像来源', ['cover', 'builtin', 'color', 'custom']),
  ],
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
    // 上游 MonetTuning.fontScale clamp 0.7-1.5（settingsPanels → MonetSettingsPanel）。
    range('fontScale', '海报字号', 0.7, 1.5, 0.05),
    // 上游 MonetPortraitSource：cover | custom（custom = 用户上传的封面图）。
    select('portraitSource', '封面来源', ['cover', 'custom']),
    select('portraitStyle', '封面形状', ['square', 'rectangular']),
  ],
  pendolo: [
    // clamp 边界逐字对齐上游 PendoloSettingsPanel（-0.20-0.40 / 0.25-0.8 / 40-160 step 5 / 0.5-2 / 1-1.6）。
    range('wheelCenterX', '表盘横向位置', -0.2, 0.4, 0.01),
    range('arcRadius', '圆弧半径', 0.25, 0.8, 0.01),
    range('arcAngleDeg', '圆弧角度', 40, 160, 5),
    range('tickSnappiness', '机械回弹', 0.5, 2, 0.1),
    range('activeScale', '当前行比例', 1, 1.6, 0.1),
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
    // 上游 SonnetSettingsPanel：textureResolution 0.5-4 step 0.25。
    range('textureResolution', '纹理精度', 0.5, 4, 0.25),
    toggle('postProcessEnabled', '后期处理'),
    // 后处理展开组（postProcessEnabled 时显示）：RgbShift/Halftone/LensDistortion/LensDispersion。
    range('postProcessGrain', '颗粒', 0, 1),
    range('postProcessContrast', '对比度', 0, 1),
    range('postProcessRgbShift', 'RGB 色差', 0, 1),
    range('postProcessHalftone', '半色调网点', 0, 1),
    range('postProcessLensDistortion', '透镜扭曲', 0, 2),
    range('postProcessLensDispersion', '色散', 0, 1),
    range('postProcessVignette', '暗角', 0, 2),
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
    // 上游 TemperaSettingsPanel：textureResolution 0.5-4 step 0.25。
    range('textureResolution', '纹理精度', 0.5, 4, 0.25),
    toggle('postProcessEnabled', '后期处理'),
    // 后处理展开组：纹理压缩开关 + 五个强度滑条（vignette/lensDistortion 0-2）。
    toggle('postProcessTextureCompression', '后处理纹理压缩'),
    range('postProcessGrain', '颗粒', 0, 1),
    range('postProcessContrast', '对比度', 0, 1),
    range('postProcessRgbShift', 'RGB 色差', 0, 1),
    range('postProcessVignette', '暗角', 0, 2),
    range('postProcessLensDistortion', '透镜扭曲', 0, 2),
  ],
  hanabi: [
    // 上游 HanabiSettingsPanel：烟花 / 画面 / 文字 / 装饰 / 配色 / 性能六组，滑块语义相同。
    range('sparkAmount', '烟花数量'),
    range('glow', '烟花辉光'),
    range('chorusBloom', '副歌辉光'),
    range('bloom', '全屏辉光'),
    toggle('launches', '升空尾迹'),
    range('sky', '夜空', 0, 1, 0.01),
    range('riseSpeed', '上升速度'),
    range('spin', '画面旋转'),
    range('ambient', '环境粒子'),
    toggle('overlayFrame', '画框'),
    toggle('textOnly', '只显示文字'),
    range('textMotion', '文字运动'),
    range('blockOpacity', '色块不透明度', 0, 1, 0.01),
    range('collage', '拼贴'),
    range('ornamentAmount', '装饰件数量'),
    select('colorMode', '配色', ['mixed', 'vivid', 'theme']),
    select('renderQuality', '画质', ['full', 'balanced', 'low']),
  ],
  lumiere: [
    // clamp 边界逐字对齐上游 LumiereSettingsPanel 的五组控件。
    range('lightIntensity', '光照强度', 0.3, 2),
    range('audioResponse', '音频响应'),
    range('bloom', '泛光'),
    range('textBloom', '文字泛光'),
    range('darkField', '暗场', 0, 1, 0.01),
    range('fogDensity', '雾密度'),
    // 雾细节（倍频数），整数 2-6。
    range('fogOctaves', '雾细节', 2, 6, 1),
    range('moteAmount', '浮尘数量'),
    toggle('frontBokeh', '前景散景'),
    toggle('lineArt', '线稿'),
    toggle('overlayFrame', '叠层边框'),
    toggle('textOnly', '只显示文字'),
    // 未唱字透明度 0.05-0.6。
    range('unlitOpacity', '未唱字透明度', 0.05, 0.6, 0.01),
    // 邻行窗口：1 = 上一行 + 当前行，2 = 再加下一行（上游 LumiereTuning 是 1|2 数值）。
    range('windowNeighbors', '邻行', 1, 2, 1),
    range('decay', '崩解强度'),
    range('echo', '背景歌词亮度'),
    toggle('trails', '轨迹线'),
    toggle('hideTrails', '隐藏轨迹线'),
    toggle('seamlessTransitions', '连续转场'),
    range('themeColorMix', '主题混色', 0, 1, 0.01),
    toggle('keywordColors', '关键词配色'),
    toggle('themeIcons', '主题图标'),
    select('renderQuality', '画质', ['full', 'balanced', 'low']),
  ],
  diorama: [
    // clamp 边界逐字对齐上游 settingsPanels（0.55-1.85 / 0.4-1.6 / 0-1.5）。
    range('cameraSpeed', '镜头速度', 0.55, 1.85),
    range('motionAmount', '镜头运动', 0.4, 1.6),
    range('audioReactivity', '音频响应', 0, 1.5),
    // 点云构成：模式切换（云海/走廊）+ 各几何体族显隐（上游 DioramaGeometrySettings）。
    { key: 'geometryVisibility.mode', label: '粒子形态', options: [{ value: 'clouds', label: '云海' }, { value: 'corridor', label: '走廊' }] },
    toggle('geometryVisibility.enabled', '点云几何'),
    toggle('geometryVisibility.strands', '几何体·柱'),
    toggle('geometryVisibility.blobs', '几何体·团'),
    toggle('geometryVisibility.ribbons', '几何体·带'),
    toggle('geometryVisibility.rings', '几何体·环'),
    // 上游 DIORAMA_PARTICLE_DENSITY 96-1536（步进经 Math.round）。
    range('particleDensity', '粒子密度', 96, 1536, 32),
    // 上游 DIORAMA_PARTICLE_SCALE 0.65-1.6 步进 0.05。
    range('particleScale', '粒子大小', 0.65, 1.6, 0.05),
    toggle('showParticles', '粒子'),
    toggle('particleGlowEnabled', '粒子辉光'),
    // 上游 DIORAMA_PARTICLE_GLOW_INTENSITY 0.1-1.5。
    range('particleGlowIntensity', '辉光强度', 0.1, 1.5),
    toggle('glowEnabled', '辉光跟唱'),
    // 背景尘壳两轴（motes-per-line = 圆周 × 径向；上游 dioramaMoteField clamp）。
    range('backgroundParticleCircumference', '尘壳·圆周', 4, 48, 1),
    range('backgroundParticleRadial', '尘壳·径向', 1, 4, 1),
    range('glowIntensity', '跟唱辉光强度', 0.1, 1.5),
    toggle('soulEnabled', '文字漂移'),
    range('soulIntensity', '漂移强度', 0.1, 1.5),
    toggle('soulActiveEnabled', '仅激活行漂移'),
    toggle('gradientEnabled', '渐变跟唱'),
    range('gradientIntensity', '渐变强度', 0.1, 1.5),
    // 上游 settingsPanels 的 diorama 关键词着色开关（主题 wordColors 成为跟唱目标色）。
    toggle('keywordColoringEnabled', '关键词配色'),
  ],
  still: [],
}

/** 嵌套路径（`geometryVisibility.mode` 形式）的读写与校验。 */
export function getTuningPath(source: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return source[key]
  // 历史存档可能把整条路径存成字面键名（'a.b'），先查字面键再走拆分路径。
  if (key in source) return source[key]
  let current: unknown = source
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function setTuningPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = current[parts[index]]
    if (!next || typeof next !== 'object') {
      current[parts[index]] = {}
    } else {
      // 不共享引用：写入前浅拷贝，避免直接改到 DEFAULT_TUNING 的嵌套对象。
      current[parts[index]] = { ...(next as Record<string, unknown>) }
    }
    current = current[parts[index]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

export function validateControl(control: FoliaControl, value: unknown): unknown {
  if (control.options) return control.options.some((item) => item.value === value) ? value : undefined
  if (control.min !== undefined && control.max !== undefined)
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(control.min, Math.min(control.max, value))
      : undefined
  return typeof value === 'boolean' ? value : undefined
}
