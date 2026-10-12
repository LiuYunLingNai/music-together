/**
 * `@chenglou/pretext` 的最小替代实现（canvas 2D 文字测量）。
 *
 * ============================ 为什么要这个文件 ============================
 *
 * folia-major 的若干视觉模式用 `@chenglou/pretext` 做文字测量与断行。
 * 那个包**只做测量**（canvas 字体度量 + 分段 + 按宽度断行），不参与渲染，
 * 但它不在本项目的依赖里。
 *
 * 移植时只有两个调用点真正需要它的能力：
 *
 *   ① `tilt`：`measureAtSize(text, pxSize, fontSpec)` —— 只取
 *      `layout.lines[0].width`，即"这段文字在给定字体下的单行宽度"。
 *   ② `cappella`：`measureBubbleText` —— 需要"按 maxWidth 断行后的
 *      每行宽度与行数"，用来算气泡尺寸。
 *
 * 两者都可以用 `CanvasRenderingContext2D.measureText` 精确复现：浏览器
 * 本来就用同一套字体度量引擎，所以宽度与上游 pretext 在同一台机器上
 * 是一致的（pretext 也是 canvas 后端）。
 *
 * ★ 这里**刻意不做** pretext 的完整分段/字距（kerning pair）优化 ——
 *   本项目的模式只用宽度和行数，不做 pretext 的富文本 inline 布局。
 *   多出来的精度没有消费者。
 *
 * ★ 无 DOM 环境（SSR / 测试）下 `document` 不存在，回退到按字符数估算，
 *   与上游 `VisualizerTilt.tsx` 自带的 `text.length * pxSize * 0.6` 回退
 *   同源同量级，不会在测试里炸掉。
 */

/** 一行断行结果。`width` 单位与传入的 pxSize 一致。 */
export interface LayoutLine {
  text: string;
  width: number
  start: number
  end: number
}

export interface LayoutResult {
  lines: LayoutLine[]
  width: number
  height: number
}

export interface PrepareOptions {
  whiteSpace?: 'normal' | 'pre-wrap' | 'nowrap'
}

/**
 * pretext 的 `prepareWithSegments` 返回值。
 *
 * 上游把它当成不透明句柄传给 `layoutWithLines`。这里保留同样的用法：
 * 句柄里存文本与字体规格，测量在 `layoutWithLines` 时一次性完成。
 */
export interface PreparedTextWithSegments {
  readonly text: string
  readonly font: string
  readonly options: PrepareOptions
}

let measureCanvas: HTMLCanvasElement | null = null
let measureContext: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext) return measureContext
  if (typeof document === 'undefined') return null
  measureCanvas = document.createElement('canvas')
  measureContext = measureCanvas.getContext('2d')
  return measureContext
}

/** 单个 grapheme 的宽度（无 canvas 时按 0.6em 估算，与上游回退一致）。 */
function measureChunkWidth(chunk: string, pxSize: number, context: CanvasRenderingContext2D | null): number {
  if (!chunk) return 0
  if (!context) return chunk.length * pxSize * 0.6
  return context.measureText(chunk).width
}

/**
 * 准备一段文字用于测量。
 *
 * `font` 与 CSS `font` 简写同形（如 `700 32px "Inter", sans-serif`），
 * 因为上游就是这样构造的（见 `cappellaBubbleMetrics.ts` 与
 * `VisualizerTilt.tsx` 的 `fontSpec`）。
 */
export function prepareWithSegments(
  text: string,
  font: string,
  options: PrepareOptions = {},
): PreparedTextWithSegments {
  return { text: text ?? '', font, options }
}

/**
 * 按 `maxWidth` 把准备好的文字断成若干行。
 *
 * 断行规则：优先在空格处断（`white-space: pre-wrap` 语义下也允许在
 * CJK 字符之间断，因为 CJK 没有空格可断）。这与 CSS 在气泡里的实际
 * 表现一致 —— 气泡是 `pre-wrap`，而 `lineHeight` 由调用方给定。
 *
 * ★ 用 grapheme 切分而不是 `split('')`：emoji / 组合字符按码点切会
 *   把一个字符切成两半，宽度会算错。
 */
export function layoutWithLines(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  lineHeight: number,
): LayoutResult {
  const context = getMeasureContext()
  const { text, font } = prepared
  const pxSize = parseFontSizePx(font)

  if (context) context.font = font

  if (!text) {
    return { lines: [], width: 0, height: 0 }
  }

  const graphemes = splitGraphemes(text)
  const lines: LayoutLine[] = []

  let currentText = ''
  let currentWidth = 0
  let currentStart = 0
  let cursor = 0
  let widest = 0

  const pushLine = (endExclusive: number) => {
    lines.push({ text: currentText, width: currentWidth, start: currentStart, end: endExclusive })
    widest = Math.max(widest, currentWidth)
    currentText = ''
    currentWidth = 0
    currentStart = endExclusive
  }

  for (const grapheme of graphemes) {
    const graphemeWidth = measureChunkWidth(grapheme, pxSize, context)
    const isSpace = /^\s+$/.test(grapheme)

    // 行首的空白不占宽度（CSS 会折叠它），否则每行都会多出一格。
    if (currentText === '' && isSpace) {
      cursor += grapheme.length
      currentStart = cursor
      continue
    }

    if (currentWidth + graphemeWidth > maxWidth && currentText !== '') {
      // 在空格处断行时，这个空格留在上一行末尾（与 CSS 一致，不另起一行）。
      if (isSpace) {
        currentText += grapheme
        currentWidth += graphemeWidth
        cursor += grapheme.length
        pushLine(cursor)
        continue
      }
      pushLine(cursor)
    }

    currentText += grapheme
    currentWidth += graphemeWidth
    cursor += grapheme.length
  }

  if (currentText !== '') pushLine(cursor)

  return {
    lines,
    width: widest,
    height: lines.length * lineHeight,
  }
}

/** 单行自然宽度：不做断行，直接把整段量出来。 */
export function measureNaturalWidth(prepared: PreparedTextWithSegments): number {
  const context = getMeasureContext()
  if (context) context.font = prepared.font
  return measureChunkWidth(prepared.text, parseFontSizePx(prepared.font), context)
}

/** 从 CSS `font` 简写里取 px 字号，用于无 canvas 时的估算回退。 */
function parseFontSizePx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font)
  return match ? Number(match[1]) : 16
}

/** grapheme 切分（与 `lib/graphemeTiming.ts` 的 `splitLyricGraphemes` 同判据）。 */
function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment)
  }
  return Array.from(text)
}
