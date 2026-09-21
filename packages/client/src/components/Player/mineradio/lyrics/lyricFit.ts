/**
 * 歌词块的视口适配。
 *
 * 参照 OpenMusic 的 `fitLyricStack`：
 *
 *   const visibleH = 2 * Math.tan(fov * 0.5) * dist
 *   const visibleW = visibleH * aspect
 *   const widthBudget  = cameraLocked ? 0.84 : 0.9
 *   const heightBudget = cameraLocked ? 0.44 : 0.52
 *   const safeW = max(visibleW * 0.36, visibleW * widthBudget - |layoutX| * 1.22)
 *   const safeH = max(visibleH * 0.16, visibleH * heightBudget - |layoutY| * 0.82)
 *   const fit   = min(1, safeW / blockW, safeH / blockH)
 *
 * 没有这一步时，网格尺寸完全由"画布宽高比"决定，而画布宽度由文字长度
 * 决定，于是短句会被放大到溢出屏幕、长句会缩得看不清。
 *
 * 本模块是纯计算，便于单独测试。
 */

export interface LyricFitInput {
  /** 相机垂直视场角（度） */
  fov: number
  /** 相机到歌词平面的距离 */
  distance: number
  /** 视口宽高比 */
  aspect: number
  /** 歌词块在未缩放时的世界宽度 */
  blockW: number
  /** 歌词块在未缩放时的世界高度 */
  blockH: number
  /** 相机是否已锁定（锁定后留出更多余量） */
  cameraLocked?: boolean
  /** 歌词块中心的横向偏移 */
  layoutX?: number
  /** 歌词块中心的纵向偏移 */
  layoutY?: number
  /** 最小可接受缩放，避免极长句被缩到不可读 */
  minScale?: number
}

export interface LyricFitResult {
  /** 应施加的整体缩放（≤1 表示只缩不放） */
  scale: number
  visibleW: number
  visibleH: number
  safeW: number
  safeH: number
}

/** 视口在给定距离上的可见世界尺寸。 */
export function visibleWorldSize(fov: number, distance: number, aspect: number): { w: number; h: number } {
  const fovRad = fov * (Math.PI / 180)
  const dist = Math.max(0.1, distance)
  const h = 2 * Math.tan(fovRad * 0.5) * dist
  return { w: h * (aspect || 1.7778), h }
}

/**
 * 计算歌词块的整体缩放。
 *
 * 结果保证歌词块占视口高度不超过 `heightBudget`、宽度不超过 `widthBudget`，
 * 因此无论句子长短，构图都稳定。
 */
export function fitLyricBlock(input: LyricFitInput): LyricFitResult {
  const {
    fov,
    distance,
    aspect,
    blockW,
    blockH,
    cameraLocked = false,
    layoutX = 0,
    layoutY = 0,
    minScale = 0.12,
  } = input

  const { w: visibleW, h: visibleH } = visibleWorldSize(fov, distance, aspect)

  const widthBudget = cameraLocked ? 0.84 : 0.9
  const heightBudget = cameraLocked ? 0.44 : 0.52

  // 与上游一致：减去中心偏移占用的空间，并保留一个下限
  const safeW = Math.max(visibleW * 0.36, visibleW * widthBudget - Math.abs(layoutX) * 1.22)
  const safeH = Math.max(visibleH * 0.16, visibleH * heightBudget - Math.abs(layoutY) * 0.82)

  const scaledW = Math.max(0.01, blockW)
  const scaledH = Math.max(0.01, blockH)

  // 只缩不放：放大短句会显得夸张，且可能溢出
  const raw = Math.min(1, safeW / scaledW, safeH / scaledH)

  return {
    scale: Math.max(minScale, raw),
    visibleW,
    visibleH,
    safeW,
    safeH,
  }
}

/**
 * 行距（世界单位）。
 *
 * 参照 Mineradio 的 `12-lyrics-row-layers.js`：
 *   step = worldH * (lineHeight / maskHeight)
 *   step *= clamp(1 + (spread - 1) * 0.32, 0.86, 1.45)
 *   step  = clamp(step, 0.22, 0.94)
 */
export function lyricLineStep(worldH: number, lineHeight: number, maskHeight: number, spread = 1): number {
  if (maskHeight <= 0) return 0.3
  let step = worldH * (lineHeight / maskHeight)
  step *= clamp(1 + (spread - 1) * 0.32, 0.86, 1.45)
  return clamp(step, 0.22, 0.94)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
