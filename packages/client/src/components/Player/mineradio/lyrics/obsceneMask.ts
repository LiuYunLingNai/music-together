/**
 * 敏感词掩码 —— 纯函数，供 WebGL 歌词舞台复用。
 *
 * ============================ 为什么独立成模块 ============================
 *
 * 这段逻辑承载了一个真实缺陷，且**只靠肉眼很难发现**：
 *
 *   设置项 `lyricMaskObsceneWordsMode` 是**三态**（`''` / `full-mask` /
 *   `partial-mask`），AMLL 侧的语义是
 *   「partial-mask = 保留首尾字符，屏蔽中间字符」
 *   （`@applemusic-like-lyrics/core` 的 `MaskObsceneWordsMode` 定义）。
 *
 *   但 WebGL 舞台此前把它折叠成布尔：
 *
 *       const obsceneChar = maskMode ? maskObsceneChar || '*' : ''
 *
 *   于是 `partial-mask` 与 `full-mask` 表现**完全相同** —— 用户在视觉舞台选
 *   "首尾保留"毫无效果，切到 AMLL 渲染器却生效。因为两种模式用的是**同一个**
 *   掩码字符，连"重建签名"都看不出差别（见 `LyricStage` 的 signature）。
 *
 * 抽成纯函数是为了能用真实取值断言，而不是靠肉眼比对渲染结果。
 */

/** 掩码模式 —— 与 AMLL `MaskObsceneWordsMode` 同域。 */
export type ObsceneMaskMode = '' | 'full-mask' | 'partial-mask'

/** 掩码字符缺省值（上游/AMLL 均为 `*`）。 */
export const DEFAULT_MASK_CHAR = '*'

/**
 * 把单个词按掩码模式替换。
 *
 * **字符数恒不变** —— 逐字高亮的区间按字符索引对齐，长度一变整行就会错位。
 */
export function maskObsceneWord(text: string, mode: ObsceneMaskMode, maskChar: string = DEFAULT_MASK_CHAR): string {
  const char = maskChar || DEFAULT_MASK_CHAR
  const chars = Array.from(text)
  if (mode === 'partial-mask') {
    // 保留首尾字符，屏蔽中间。长度 ≤ 2 时不存在"中间"，
    // 无法同时保留首尾 —— 退化为全掩码（与 AMLL 一致：它按首尾各留 1 位处理）。
    if (chars.length <= 2) return chars.map(() => char).join('')
    return (
      chars[0] +
      chars
        .slice(1, -1)
        .map(() => char)
        .join('') +
      chars[chars.length - 1]
    )
  }
  // full-mask（以及任何非 partial 的启用态）→ 全部替换
  return chars.map(() => char).join('')
}

/**
 * 按逐字 `obscene` 标记替换整行敏感词。
 *
 * 只替换被标记的词，其余原样保留；字符数不变，因此逐字区间不错位。
 */
export function maskObsceneLine<T extends { words: Array<{ text: string; obscene: boolean }> }>(
  line: T,
  mode: ObsceneMaskMode,
  maskChar: string = DEFAULT_MASK_CHAR,
): string {
  return line.words.map((word) => (word.obscene ? maskObsceneWord(word.text, mode, maskChar) : word.text)).join('')
}
