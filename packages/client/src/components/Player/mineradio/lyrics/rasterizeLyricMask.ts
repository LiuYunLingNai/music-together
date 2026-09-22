/**
 * 歌词文本栅格化。
 *
 * 参照 Mineradio 的实现（`10-lyrics-mask-textures.js` /
 * `13-lyrics-mesh-build.js`）：
 *
 * - 字号固定 128px 作为**栅格化分辨率**（不是屏幕像素）；
 *   屏幕上的实际大小由相机投影与网格世界尺寸决定。
 * - 画布高度按行数取档（384 → 1344）。
 * - 输出一张 RGBA 画布，其中：
 *     R 通道 = 该行是否为当前激活行（1 = 激活）
 *     A 通道 = 文字遮罩
 *   着色器据此让非激活行不参与逐字高亮与辉光。
 *
 * 本模块是纯 Canvas2D，不依赖 three.js，便于单独测试与复用。
 */

import type { CoverPalette } from './coverPalette'

/** 栅格化字号（Mineradio 原值） */
export const LYRIC_FONT_SIZE = 128
export const LYRIC_LINE_HEIGHT_FACTOR = 1.08
export const LYRIC_LINE_HEIGHT = LYRIC_FONT_SIZE * LYRIC_LINE_HEIGHT_FACTOR

/**
 * 上游主遮罩画布基础宽（`beginLyricMaskLayoutBuild` 的 `baseCanvasW`）。
 *
 * 画布宽度**不是**随文字伸缩：上游恒定从 2048 起，最宽行放不下时收缩
 * 字号（每步 -4，下限 42/46），只有超长行才把画布加宽到 `widest + pad`。
 * 文字在平面里的世界占比因此恒定 —— 12 字行约占 6.1 世界宽的 75%，
 * 右缘不会压到侧边卡片。此前本项目把宽度预算当成视口下限（方向搞反，
 * 上游的 `lyricRowTextureWidthBudget` 只是 GPU 显存压缩上限），导致
 * 短句画布被压窄、长句文字撑满整块平面。
 */
export const LYRIC_MASK_BASE_WIDTH = 2048
/** 上游 `maxWidth = baseCanvasW - 88`：字号收缩的宽度预算。 */
const LYRIC_MASK_MAX_TEXT_WIDTH = LYRIC_MASK_BASE_WIDTH - 88

/**
 * 画布高度档位，与 Mineradio 的 `10-lyrics-mask-textures.js` 一致。
 */
export function lyricCanvasHeightForLineCount(lineCount: number): number {
  const n = Math.max(1, Math.round(lineCount))
  if (n > 9) return 1344
  if (n > 8) return 1216
  if (n > 7) return 1088
  if (n > 6) return 960
  if (n > 5) return 832
  if (n > 4) return 704
  if (n > 3) return 608
  if (n > 2) return 512
  return 384
}

export interface RasterizedLine {
  text: string
  /** 相对画布顶部的中心 Y（px） */
  y: number
  fontSize: number
  /** 该行渲染后的像素宽度 */
  width: number
  /** 是否为当前激活行 */
  active: boolean
  /** 该行是否需要右对齐（对唱） */
  duet: boolean
  /** 该行的整体透明度（描边层按上游逐行乘入） */
  alpha: number
}

export interface LyricMask {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** 文字区域的实际起止 X（px），供着色器做字符区间映射 */
  textMin: number
  textMax: number
  /** 每行在画布中的垂直位置，供 3D 侧定位或点击命中 */
  lines: RasterizedLine[]
  /**
   * 激活行的实际像素宽度（上游 `activeTextWidth`）。
   *
   * 着色器的逐字高亮按 `textMin..textMax` 在 UV.x 上插值；上游的
   * `textMin/textMax` 只覆盖**激活行**的真实宽度（非整画布），长上下文行
   * 不会稀释逐字进度。此前本项目用"画布内所有行"的并集宽度，长行窗口
   * 会把当前行的字符进度拉稀。
   */
  activeTextWidth: number
  /**
   * 可读性描边层（上游 `makeLyricReadabilityTexture`，10-lyrics-mask-textures.js）：
   * 黑色模糊晕 + 白色描边，与主文字同布局，绘制在文字平面之后。
   * 无背景色板约束下的"字压在花封面上看不清"主要靠它解决。
   */
  readabilityCanvas: HTMLCanvasElement | null
  /** 画布释放 */
  dispose: () => void
}

export interface LyricRasterOptions {
  /** 参与栅格化的行（通常为当前句 + 上下文） */
  entries: Array<{
    text: string
    active: boolean
    /** 上下文行的缩放（1 = 当前行） */
    scale: number
    /**
     * 该行的整体透明度。上下文行低于 1，形成纵深层次。
     * 与 Mineradio 的 nearAlpha/farAlpha 对应。
     */
    alpha?: number
    duet?: boolean
    /** 附属小字（译词/音译），跟在主行下方 */
    subLines?: string[]
  }>
  /** 遮罩文字不雅词用的字符；由调用方决定哪些文本已被遮罩 */
  obsceneMaskChar?: string
  fontFamily?: string
  fontWeight?: number
}

const DEFAULT_FONT_FAMILY =
  '"Plus Jakarta Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'

function buildFont(fontSize: number, weight: number, family: string): string {
  return `${weight} ${fontSize}px ${family}`
}

/**
 * 把歌词行栅格化成遮罩画布。
 *
 * 失败（无 2D 上下文等）时返回 null，由调用方回退到经典歌词渲染。
 */
export function rasterizeLyricMask(options: LyricRasterOptions): LyricMask | null {
  // 上游出厂字重 750（`fx.lyricWeight`，04-fx-defaults.js:51，夹取 [500,900]）。
  // 此前用 600 —— 字重偏细是"歌词可读性差"的直接原因之一。
  const { entries, fontFamily = DEFAULT_FONT_FAMILY, fontWeight = 750 } = options
  if (entries.length === 0) return null

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) return null

  const family = fontFamily
  const weight = fontWeight

  // 先测量：确定每行的实际宽度与整体所需宽度
  interface Measured {
    text: string
    subLines: string[]
    active: boolean
    duet: boolean
    alpha: number
    fontSize: number
    subFontSize: number
    width: number
    subWidth: number
    lineHeight: number
    /** 该行占用的总高度（含附属小字） */
    blockHeight: number
  }

  const measured: Measured[] = []
  let widest = 1

  for (const entry of entries) {
    const fontSize = LYRIC_FONT_SIZE * (entry.active ? 1 : entry.scale)
    ctx.font = buildFont(fontSize, weight, family)
    // 敏感词遮罩由调用方在传入前完成（它掌握逐字级的 obscene 标记），
    // 这里只负责栅格化，避免在整行层面误替换。
    const text = entry.text
    const width = Math.max(1, ctx.measureText(text).width)

    const subFontSize = fontSize * 0.52
    ctx.font = buildFont(subFontSize, weight, family)
    let subWidth = 0
    for (const sub of entry.subLines ?? []) {
      subWidth = Math.max(subWidth, ctx.measureText(sub).width)
    }

    const subCount = entry.subLines?.length ?? 0
    const lineHeight = fontSize * LYRIC_LINE_HEIGHT_FACTOR
    const blockHeight = lineHeight + subCount * subFontSize * 1.28

    measured.push({
      text,
      subLines: entry.subLines ?? [],
      active: entry.active,
      duet: Boolean(entry.duet),
      alpha: entry.alpha ?? 1,
      fontSize,
      subFontSize,
      width,
      subWidth,
      lineHeight,
      blockHeight,
    })

    widest = Math.max(widest, width, subWidth)
  }

  // ★ 画布宽度对齐上游 `finalizeLyricMaskLayoutBuild`（10-lyrics-mask-textures.js）：
  //   固定 2048 基宽；最宽行放不下（+padding 仍超预算）时**收缩字号**而不是
  //   加宽画布（上游每步 -4、下限 46），只有超长行才把画布加宽到 widest+pad。
  //   这样文字在平面里的世界占比与上游一致（典型 12 字行 ≈ 75% 宽），
  //   不再顶满全宽压到侧边卡片。此前把上游的显存压缩预算当成了视口下限
  //   （方向反了），短句画布被压窄、长句文字撑满整块平面。
  const canvasWidthPad = Math.max(220, LYRIC_FONT_SIZE * 2.2)
  const maxWidth = LYRIC_MASK_MAX_TEXT_WIDTH
  if (widest + canvasWidthPad > maxWidth) {
    // 上游字号收缩（每步 -4、下限 46）的等价一次求解：
    // fitRatio = maxWidth / (widest + pad)，字号向下取到 4 的倍数。
    const fitRatio = maxWidth / (widest + canvasWidthPad)
    const shrunk = Math.max(46, Math.floor((LYRIC_FONT_SIZE * Math.max(0.01, fitRatio)) / 4) * 4)
    if (shrunk < LYRIC_FONT_SIZE) {
      const shrinkFactor = shrunk / LYRIC_FONT_SIZE
      for (const m of measured) {
        m.fontSize *= shrinkFactor
        m.subFontSize *= shrinkFactor
        m.lineHeight *= shrinkFactor
        m.blockHeight *= shrinkFactor
      }
      // 收缩后按实际字号重新测量（文本宽度与字号非线性，必须重测）
      ctx.font = buildFont(shrunk, weight, family)
      widest = 1
      for (const m of measured) {
        ctx.font = buildFont(m.fontSize, weight, family)
        m.width = Math.max(1, ctx.measureText(m.text).width)
        ctx.font = buildFont(m.subFontSize, weight, family)
        m.subWidth = 0
        for (const sub of m.subLines) {
          m.subWidth = Math.max(m.subWidth, Math.max(1, ctx.measureText(sub).width))
        }
        widest = Math.max(widest, m.width, m.subWidth)
      }
    }
  }
  // 上游：neededCanvasW = min(maxCanvasW, max(2048, widest + pad))，64 对齐
  const W = Math.ceil(Math.min(6144, Math.max(LYRIC_MASK_BASE_WIDTH, widest + canvasWidthPad)) / 64) * 64
  const presetHeight = lyricCanvasHeightForLineCount(measured.length)
  const totalHeight = measured.reduce((sum, m) => sum + m.blockHeight, 0)
  const activeMeasuredIndex = measured.findIndex((m) => m.active)
  const activeAnchor =
    activeMeasuredIndex >= 0
      ? measured.slice(0, activeMeasuredIndex).reduce((sum, m) => sum + m.blockHeight, 0) +
        measured[activeMeasuredIndex].lineHeight / 2
      : totalHeight / 2
  const verticalPadding = 48
  // 以“当前主歌词行”而不是“主行 + 翻译/音译块”作为视觉中心。
  // 同时给上下两侧留出对称空间，副歌词再多也不会把主行向上顶偏。
  const anchoredHeight = Math.ceil(Math.max(activeAnchor, totalHeight - activeAnchor) * 2 + verticalPadding * 2)
  const H = Math.max(presetHeight, Math.ceil(totalHeight + verticalPadding * 2), anchoredHeight)

  canvas.width = W
  canvas.height = H

  // 重新设置尺寸会重置上下文状态，需重设字体
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 当前主行固定在画布中心；若位于歌曲开头/结尾，再钳制到安全区。
  const centeredCursor = H / 2 - activeAnchor
  const maxCursor = Math.max(verticalPadding, H - totalHeight - verticalPadding)
  let cursorY = Math.max(verticalPadding, Math.min(maxCursor, centeredCursor))

  const rasterized: RasterizedLine[] = []

  for (const m of measured) {
    // 主行只按自身行高定位，附属小字单独向下展开。
    // 不能用 blockHeight / 2，否则副歌词会改变主行的视觉中心。
    const centerY = cursorY + m.lineHeight / 2

    ctx.font = buildFont(m.fontSize, weight, family)

    // 对唱行靠右：整体右移，使行右缘贴近画布右侧（0.55 偏移系数同上游）。
    // canvasWidthPad 是画布两侧的统一留白（上游 pad 的等价物）。
    const centerX = W / 2

    // R 通道编码"该行是否为当前激活行"：
    //   激活行用白色 → R=255，着色器据此开启逐字高亮与辉光
    //   非激活行用黑色 → R=0，只作为文字遮罩存在
    // A 通道承载该行的层次透明度（上下文行 < 1），形成纵深。
    const rgb = m.active ? '255,255,255' : '0,0,0'
    ctx.fillStyle = `rgba(${rgb},${m.alpha})`
    fillText(ctx, m.text, centerX, centerY)

    rasterized.push({
      text: m.text,
      y: centerY,
      fontSize: m.fontSize,
      width: m.width,
      active: m.active,
      duet: m.duet,
      alpha: m.alpha,
    })

    // 附属小字（译词 / 音译）。
    // 必须沿用与主行相同的 R 策略：非激活行的附属文字也必须是 R=0，
    // 否则着色器会把上下文行的译词误判为激活行。
    let subY = centerY + m.fontSize * LYRIC_LINE_HEIGHT_FACTOR * 0.62
    ctx.font = buildFont(m.subFontSize, weight, family)
    for (const sub of m.subLines) {
      // 附属文字整体比主行更淡，激活行用浅灰保持 R 通道为高值
      const subRgb = m.active ? '210,210,210' : '0,0,0'
      ctx.fillStyle = `rgba(${subRgb},${m.alpha * 0.8})`
      fillText(ctx, sub, centerX, subY)
      subY += m.subFontSize * 1.28
    }

    cursorY += m.blockHeight
  }

  // ★ textMin/textMax 对齐上游语义：只覆盖**激活行**的真实范围
  //   （finalizeLyricMaskLayoutBuild: textMin = (W/2 - activeWidth/2) / W）。
  //   逐字高亮在 textMin..textMax 上插值 —— 用"所有行的并集宽度"会让
  //   长上下文行稀释当前行的字符进度。文字一律居中（上游无对唱偏移）。
  const activeRasterized = rasterized.find((l) => l.active) ?? rasterized[0]
  const activeCenterX = W / 2
  const activeWidth = Math.max(1, activeRasterized.width)

  return {
    canvas,
    width: W,
    height: H,
    // 文字区域在整个画布中水平居中，供着色器把 UV.x 映射到字符位置
    textMin: activeCenterX - activeWidth / 2,
    textMax: activeCenterX + activeWidth / 2,
    lines: rasterized,
    activeTextWidth: activeWidth,
    readabilityCanvas: null, // 由 rasterizeReadabilityMask 单独构建
    dispose: () => {
      canvas.width = 1
      canvas.height = 1
    },
  }
}

/** 逐字绘制，保证中文与西文都能正确绘制。 */
function fillText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillText(text, x, y)
}

// ======================================================================
// 逐行分层（上游 `12-lyrics-row-layers.js` 的 makeLyricLineMask / lyricRow*）
// ======================================================================

/** 单行栅格化结果 —— 上游 `makeLyricLineMask` 产出的 lineMask 的等价物。 */
export interface LyricLineRaster {
  canvas: HTMLCanvasElement
  /** 该行的主文本（供可读性描边重描用，上游 row.text） */
  text: string
  /** 画布宽度（px），2048 基宽 + 收缩链与整块遮罩一致 */
  width: number
  height: number
  /** 该行文字的实际像素宽度（上游 activeTextWidth） */
  textWidth: number
  /**
   * 文字中心相对画布中心的 X 偏移。
   *
   * ★ 恒为 0：上游 Mineradio 没有对唱概念，所有行一律居中绘制
   *   （10-lyrics-mask-textures.js:348/465/608/760 的 `x = W / 2`）。
   *   保留该字段是为了不改动调用方的 `uTextMin/uTextMax` 公式。
   */
  centerOffsetX: number
  /** 栅格化字号（可能因宽度预算收缩过） */
  fontSize: number
  /** 附属小字（译词/音译）已画入同一画布，这是它们的起始 Y 相对主行中心 */
  subLines: string[]
  dispose: () => void
}

/**
 * 单行栅格化（上游 `makeLyricLineMask`，12-lyrics-row-layers.js:201-218）。
 *
 * 逐行分层架构里每行是**独立**的遮罩纹理 + 网格：滚动轨道逐行位移、
 * 逐行深度/缩放/透明度、逐行揭示动画都因此成为可能。整块画布方案
 * （rasterizeLyricMask）里行位置是烘焙死的，换一行就要整张重栅格化。
 *
 * alpha **不**烘焙进画布 —— 由材质 opacity 逐帧控制（上游 row.targetAlpha
 * 语义），这样上下文行淡入淡出不需要重栅格化。
 *
 * 字号沿用 128px 栅格分辨率；画布宽 = 2048 基宽，超宽行走同一收缩链。
 */
export function rasterizeLyricLineMask(options: {
  text: string
  /** 附属小字（译词/音译），跟在主行下方 */
  subLines?: string[]
  /** 行缩放（上下文行 < 1，影响栅格字号） */
  scale?: number
  /**
   * 对唱标记 —— **仅用于保留调用方语义，不影响绘制**。
   *
   * 上游 Mineradio 没有对唱概念（全仓 grep `duet` 零命中），所有行一律
   * 居中；这里接受该字段只是为了不改动调用方签名，绘制时忽略它。
   */
  duet?: boolean
  fontFamily?: string
  fontWeight?: number
}): LyricLineRaster | null {
  const { text, subLines = [], scale = 1, fontFamily = DEFAULT_FONT_FAMILY, fontWeight = 750 } = options

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) return null

  // 主行字号：基准 × 行缩放（上游 entry.scale）
  let fontSize = LYRIC_FONT_SIZE * scale
  const subFontSize = fontSize * 0.52

  // 测量：主行 + 附属小字的最宽者
  ctx.font = buildFont(fontSize, fontWeight, fontFamily)
  let textWidth = Math.max(1, ctx.measureText(text).width)
  ctx.font = buildFont(subFontSize, fontWeight, fontFamily)
  let subWidth = 0
  for (const sub of subLines) {
    subWidth = Math.max(subWidth, ctx.measureText(sub).width)
  }
  let widest = Math.max(textWidth, subWidth)

  // 上游同一收缩链（finalizeLyricMaskLayoutBuild）：2048 基宽，
  // widest + pad 超预算时字号收缩，重测宽度
  const canvasWidthPad = Math.max(220, LYRIC_FONT_SIZE * 2.2)
  const maxWidth = LYRIC_MASK_MAX_TEXT_WIDTH
  if (widest + canvasWidthPad > maxWidth) {
    const fitRatio = maxWidth / (widest + canvasWidthPad)
    const shrunk = Math.max(46, Math.floor((fontSize * Math.max(0.01, fitRatio)) / 4) * 4)
    if (shrunk < fontSize) {
      const shrinkFactor = shrunk / fontSize
      fontSize *= shrinkFactor
      ctx.font = buildFont(fontSize, fontWeight, fontFamily)
      textWidth = Math.max(1, ctx.measureText(text).width)
      const subShrunk = fontSize * 0.52
      ctx.font = buildFont(subShrunk, fontWeight, fontFamily)
      subWidth = 0
      for (const sub of subLines) {
        subWidth = Math.max(subWidth, ctx.measureText(sub).width)
      }
      widest = Math.max(textWidth, subWidth)
    }
  }

  // 画布宽对齐上游：min(6144, max(2048, widest + pad))，64 对齐。
  // 行内加宽的画布只影响行平面宽（世界宽随之放大，见 LyricStage），
  // 文字仍居中 —— 上游 lyricRowLogicalWorldWidth 的 clamp(logical/2048, 1, 3)。
  const W = Math.ceil(Math.min(6144, Math.max(LYRIC_MASK_BASE_WIDTH, widest + canvasWidthPad)) / 64) * 64
  const mainLineHeight = fontSize * LYRIC_LINE_HEIGHT_FACTOR
  const subGap = subFontSize * 1.28
  const H = Math.ceil(mainLineHeight + subLines.length * subGap + 48)

  canvas.width = W
  canvas.height = H
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ★ 文字一律水平居中 —— 上游 Mineradio **没有**「对唱」概念：
  //   grep -rIli "duet" public/js/ = 0 命中，且所有文字绘制都是
  //   `var x = W / 2` + `ctx.textAlign = 'center'`
  //   （10-lyrics-mask-textures.js:348/350、:465、:608、:760），
  //   网格也恒为 `mesh.position.set(0, lineY, lineZ)`
  //   （12-lyrics-row-layers.js:457）。
  //
  //   此前这里按"对唱行右移 0.55 系数"绘制，那套公式**没有上游依据**，
  //   且偏移量随行长变化（短行 +376px、长行 +18px）—— 同一次副歌里
  //   连续几句对唱的右缘散开约 20% 画布宽，看起来"不和谐、不对称"。
  //   更糟的是辉光层用 W/2（rasterizeLineGlowMask）、描边层又用 48 而非
  //   canvasWidthPad，三层各自算出的中心互不相同。
  //   现在统一回到上游的居中语义，三层自然对齐。
  const centerX = W / 2
  const centerY = H / 2 - (subLines.length * subGap) / 2

  // R/A 通道语义与整块遮罩一致（R=激活行标记，A=遮罩）。
  // 单行栅格由调用方决定这行是否激活；上下文行的 R 通道为 0，
  // 着色器据此关闭逐字高亮与辉光。
  ctx.fillStyle = 'rgba(255,255,255,1)'
  ctx.font = buildFont(fontSize, fontWeight, fontFamily)
  fillText(ctx, text, centerX, centerY)

  // 附属小字：R 通道用中灰（210）——激活行的译词参与高亮但更淡
  let subY = centerY + fontSize * LYRIC_LINE_HEIGHT_FACTOR * 0.62
  ctx.font = buildFont(subFontSize, fontWeight, fontFamily)
  for (const sub of subLines) {
    ctx.fillStyle = 'rgba(210,210,210,1)'
    fillText(ctx, sub, centerX, subY)
    subY += subGap
  }

  return {
    canvas,
    text,
    width: W,
    height: H,
    textWidth,
    centerOffsetX: centerX - W / 2,
    fontSize,
    subLines,
    dispose: () => {
      canvas.width = 1
      canvas.height = 1
    },
  }
}

/**
 * 可读性描边层 —— 忠实移植上游 `stepLyricReadabilityTextureBuild`
 * （10-lyrics-mask-textures.js:663-714）的四段描边：
 *
 *   0. 宽黑晕：blur 14、alpha 0.18、lineWidth max(18, fontSize*0.16)、y+0.018em
 *   1. 中黑晕：blur 5、alpha 0.32、lineWidth max(9, fontSize*0.075)、y+0.012em
 *   2. 宽白描边：blur 4、alpha 0.15、lineWidth max(9, fontSize*0.070)
 *   3. 细白描边：blur 1.2、alpha 0.26、lineWidth max(3.2, fontSize*0.030)
 *
 * 叠加顺序与上游一致（先黑后白，白压在黑上），文字形状之外没有矩形底。
 * 上游把这套描边做成独立的 readability 平面（renderOrder 略低于文字、
 * z 后移 0.012），本项目沿用同一布局。
 */
export function rasterizeReadabilityMask(source: LyricMask): HTMLCanvasElement | null {
  if (source.lines.length === 0) return null
  const { width: W, height: H, lines } = source

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, W, H)

  const centerX = W / 2
  const baseFontSize = lines.find((l) => l.active)?.fontSize ?? lines[0].fontSize

  // 描边笔触共用主画布的文字位置（上游恒为 W/2，无对唱偏移）；
  // lineWidth 相对激活行字号缩放（上游按 entry.scale 同理）。
  const drawStrokes = (phaseAlpha: number, dy: number) => {
    for (const line of lines) {
      ctx.font = buildFont(line.fontSize, 750, DEFAULT_FONT_FAMILY)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.miterLimit = 2
      // 上游 drawLyricReadabilityStrokeLines：描边 alpha 逐行乘入该行的
      // 整体透明度（globalAlpha = phaseAlpha * entry.alpha）—— 上下文行
      // 的描边更淡，与主文字的纵深一致。此前漏乘，上下文行描边过重。
      ctx.globalAlpha = phaseAlpha * Math.max(0.1, line.alpha)
      ctx.strokeText(line.text, centerX, line.y + dy)
    }
  }

  const phases = readabilityPhases(baseFontSize)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const phase of phases) {
    ctx.save()
    ctx.filter = `blur(${Math.max(0.45, phase.blur).toFixed(2)}px)`
    ctx.globalAlpha = phase.alpha
    ctx.lineWidth = phase.width
    ctx.strokeStyle = phase.color
    drawStrokes(phase.alpha, phase.dy)
    ctx.restore()
  }

  return out
}

/** 上游四段描边参数（stepLyricReadabilityTextureBuild，10-lyrics-mask-textures.js:663-714）。 */
interface ReadabilityPhase {
  blur: number
  alpha: number
  width: number
  color: string
  dy: number
}

function readabilityPhases(baseFontSize: number): ReadabilityPhase[] {
  return [
    {
      blur: 14,
      alpha: 0.18,
      width: Math.max(18, baseFontSize * 0.16),
      color: 'rgba(0,0,0,1)',
      dy: baseFontSize * 0.018,
    },
    {
      blur: 5,
      alpha: 0.32,
      width: Math.max(9, baseFontSize * 0.075),
      color: 'rgba(0,0,0,1)',
      dy: baseFontSize * 0.012,
    },
    { blur: 4, alpha: 0.15, width: Math.max(9, baseFontSize * 0.07), color: 'rgba(255,255,255,1)', dy: 0 },
    { blur: 1.2, alpha: 0.26, width: Math.max(3.2, baseFontSize * 0.03), color: 'rgba(255,255,255,1)', dy: 0 },
  ]
}

/**
 * 单行可读性描边（上游逐行分层的 readability 层，每行独立一张）。
 *
 * 与整块版四段描边完全同参；主行 + 附属小字一起描边，
 * 画布与传入的行遮罩同尺寸，直接叠在行网格后 0.012
 * （上游 row.readability.position.z = row.baseZ - 0.012，
 * 12-lyrics-row-layers.js:551）。
 *
 * 文本由调用方传回 —— 上游同样是逐行文本重描（drawLyricReadabilityStrokeLines），
 * 不从画布反推。
 */
export function rasterizeLineReadabilityMask(line: LyricLineRaster): HTMLCanvasElement | null {
  const W = line.width
  const H = line.height

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const centerX = W / 2 + line.centerOffsetX
  const subGap = line.fontSize * 0.52 * 1.28
  const mainCenterY = H / 2 - (line.subLines.length * subGap) / 2

  const phases = readabilityPhases(line.fontSize)

  for (const phase of phases) {
    ctx.save()
    ctx.filter = `blur(${Math.max(0.45, phase.blur).toFixed(2)}px)`
    ctx.globalAlpha = phase.alpha
    ctx.lineWidth = phase.width
    ctx.strokeStyle = phase.color
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.miterLimit = 2
    ctx.font = buildFont(line.fontSize, 750, DEFAULT_FONT_FAMILY)
    ctx.strokeText(line.text, centerX, mainCenterY + phase.dy)
    ctx.font = buildFont(line.fontSize * 0.52, 750, DEFAULT_FONT_FAMILY)
    let subY = mainCenterY + line.fontSize * LYRIC_LINE_HEIGHT_FACTOR * 0.62
    for (const sub of line.subLines) {
      ctx.strokeText(sub, centerX, subY + phase.dy)
      subY += subGap
    }
    ctx.restore()
  }

  return out
}

// ======================================================================
// 辉光纹理（上游 10-lyrics-mask-textures.js 的 makeLyricGlowTexture，
//          + 12-lyrics-row-layers.js 的 makeLyricRowGlowMesh）
// ======================================================================

/** 辉光栅格化参数说明见 rasterizeLineGlowMask 内注释。 */

/**
 * 单行辉光纹理（上游 makeLyricGlowTexture 的同步等价）。
 *
 * 结构（stepLyricGlowTextureBuild 逐相位）：
 *   0-3. 白色文字+描边的四级模糊 pass：
 *        blur 14/34/78/116 ×pixelScale，alpha 0.46/0.34/0.22/0.13，
 *        lineWidth max(10·ps, fs·0.10) → max(18,0.18fs) → max(28,0.26fs) → max(42,0.40fs)
 *   4-11. 8 个方向的径向描边 pass（globalCompositeOperation 'lighter'，
 *         blur 8·ps，alpha 0.26，偏移 cos×7·ps / sin×4·ps）
 *   12.   X/Y 双向边缘渐隐（destination-in，0.10/0.16 内渐入、0.90/0.84 后渐出）
 *
 * 辉光是**白色**的能量图：颜色由材质 uColor 在 GPU 侧乘出
 * （上游 makeLyricBackfaceReadableMaterial），画布只负责形状。
 */
export function rasterizeLineGlowMask(line: LyricLineRaster): HTMLCanvasElement | null {
  const text = line.text.replace(/\s+/g, ' ').trim()

  // 上游 beginLyricGlowTextureBuild 布局：pixelScale = 栅格缩放（≤1）
  const pixelScale = Math.max(0.2, Math.min(1, line.fontSize / LYRIC_FONT_SIZE))
  const fontSize = line.fontSize
  const padX = Math.max(160 * pixelScale, fontSize * 1.45)
  const padY = Math.max(86 * pixelScale, fontSize * 0.78)

  // 文字测量：主行 + 附属小字（小字描边更细、alpha 更低，同 drawLyricGlowText）
  const measure = document.createElement('canvas')
  const mctx = measure.getContext('2d')
  if (!mctx) return null
  mctx.font = buildFont(fontSize, 750, DEFAULT_FONT_FAMILY)
  let measuredWidth = Math.max(1, mctx.measureText(text).width)
  mctx.font = buildFont(fontSize * 0.52, 750, DEFAULT_FONT_FAMILY)
  for (const sub of line.subLines) {
    measuredWidth = Math.max(measuredWidth, mctx.measureText(sub).width)
  }

  const W = Math.ceil(Math.min(6144, measuredWidth + padX * 2))
  const blockH = fontSize + line.subLines.length * fontSize * 0.52 * 1.28
  const H = Math.ceil(blockH + padY * 2)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  // 上游 textBaseline = 'alphabetic'，y0 = H/2 + fontSize*0.36（行中心基线）
  ctx.textBaseline = 'alphabetic'
  const y0 = H / 2 + fontSize * 0.36
  // 辉光层与主行、描边层共用同一文字中心（上游恒为画布水平居中）。
  // 此前主行按"对唱右移"画、辉光却用 W/2，两者错开最多 376px
  // （18% 平面宽）—— 辉光晕浮在字形左边。居中语义下三层天然对齐。
  const centerX = W / 2

  /** 一遍文字+描边绘制（上游 drawLyricGlowText 的单行等价）。 */
  const drawGlowText = (dx: number, dy: number) => {
    ctx.font = buildFont(fontSize, 750, DEFAULT_FONT_FAMILY)
    if (ctx.lineWidth > 0) ctx.strokeText(text, centerX + dx, y0 + dy)
    ctx.fillText(text, centerX + dx, y0 + dy)
    // 附属小字：lineWidth ×0.48、alpha ×0.34（上游 translationLine 分支）
    if (line.subLines.length > 0) {
      ctx.font = buildFont(fontSize * 0.52, 750, DEFAULT_FONT_FAMILY)
      ctx.lineWidth = Math.max(1.8 * pixelScale, ctx.lineWidth * 0.48)
      ctx.globalAlpha *= 0.34
      let subY = y0 + fontSize * LYRIC_LINE_HEIGHT_FACTOR * 0.62
      for (const sub of line.subLines) {
        if (ctx.lineWidth > 0) ctx.strokeText(sub, centerX + dx, subY + dy)
        ctx.fillText(sub, centerX + dx, subY + dy)
        subY += fontSize * 0.52 * 1.28
      }
    }
  }

  const blurPass = (filter: string, alpha: number, lineWidth: number) => {
    ctx.save()
    ctx.filter = filter
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#fff'
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = '#fff'
    drawGlowText(0, 0)
    ctx.restore()
  }

  // 0-3. 四级模糊
  blurPass(`blur(${Math.max(1, 14 * pixelScale).toFixed(2)}px)`, 0.46, Math.max(10 * pixelScale, fontSize * 0.1))
  blurPass(`blur(${Math.max(1.5, 34 * pixelScale).toFixed(2)}px)`, 0.34, Math.max(18 * pixelScale, fontSize * 0.18))
  blurPass(`blur(${Math.max(2, 78 * pixelScale).toFixed(2)}px)`, 0.22, Math.max(28 * pixelScale, fontSize * 0.26))
  blurPass(`blur(${Math.max(3, 116 * pixelScale).toFixed(2)}px)`, 0.13, Math.max(42 * pixelScale, fontSize * 0.4))

  // 4-11. 八向径向描边（lighter 合成）
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = `blur(${Math.max(0.8, 8 * pixelScale).toFixed(2)}px)`
  ctx.globalAlpha = 0.26
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 0
  ctx.strokeStyle = '#fff'
  for (let ri = 0; ri < 8; ri++) {
    const ang = (ri / 8) * Math.PI * 2
    drawGlowText(Math.cos(ang) * 7 * pixelScale, Math.sin(ang) * 4 * pixelScale)
  }
  ctx.restore()

  // 12. 边缘渐隐（destination-in，X 0.10/0.90、Y 0.16/0.84）
  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  const xMask = ctx.createLinearGradient(0, 0, W, 0)
  xMask.addColorStop(0.0, 'rgba(255,255,255,0)')
  xMask.addColorStop(0.1, 'rgba(255,255,255,1)')
  xMask.addColorStop(0.9, 'rgba(255,255,255,1)')
  xMask.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = xMask
  ctx.fillRect(0, 0, W, H)
  const yMask = ctx.createLinearGradient(0, 0, 0, H)
  yMask.addColorStop(0.0, 'rgba(255,255,255,0)')
  yMask.addColorStop(0.16, 'rgba(255,255,255,1)')
  yMask.addColorStop(0.84, 'rgba(255,255,255,1)')
  yMask.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = yMask
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  return canvas
}

/**
 * 辉光颜色（上游 lyricRowGlowThreeColor + lyricResolvedGlowColor + lyricThreeColor）。
 *
 * 颜色链：palette 的 secondary → highlight → primary，fallback #9cffdf
 * （上游 lyricResolvedGlowColor 的 pal.glowColor→secondary→highlight→primary，
 * 本项目 CoverPalette 没有 glowColor 字段，从 secondary 起）。
 * 纯 JS 实现（避免本模块依赖 three.js）：不足最低亮度 0.40 时 RGB 同加。
 */
export function glowColorForPalette(palette: CoverPalette | null): string {
  const css = palette?.secondary ?? palette?.highlight ?? palette?.primary ?? '#9cffdf'
  const m = /^#?([0-9a-f]{6})$/i.exec(css)
  let r = 0.62
  let g = 1
  let b = 0.87 // #9cffdf
  if (m) {
    const n = parseInt(m[1], 16)
    r = ((n >> 16) & 255) / 255
    g = ((n >> 8) & 255) / 255
    b = (n & 255) / 255
  }
  const lum = r * 0.299 + g * 0.587 + b * 0.114
  if (lum < 0.4) {
    const lift = 0.4 - lum
    r = Math.min(1, r + lift)
    g = Math.min(1, g + lift)
    b = Math.min(1, b + lift)
  }
  const to255 = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to255(r)}${to255(g)}${to255(b)}`
}
