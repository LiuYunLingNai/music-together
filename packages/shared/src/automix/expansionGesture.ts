// 上游 `expansionGesture.ts` 的决策部分：只根据两侧电平选 build-up 强度。
// 排布与渲染依赖真实 stem 缓冲，留给客户端分轨 deck。

const STEPS = [0.25, 0.5, 0.75, 1] as const

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const nearestStep = (intensity: number): number =>
  STEPS.reduce((best, candidate) =>
    Math.abs(candidate - intensity) < Math.abs(best - intensity) ? candidate : best,
  )

/**
 * 入歌比出歌响是唯一会让 build-up 帮倒忙的情况；其余一律往上推。
 * 永不返回 0：开关已经回答“要不要”，这里只回答“多强”。
 */
export const chooseExpansionIntensity = (evidence: {
  tailDb?: number | null
  headDb?: number | null
  startsHot?: boolean | null
}): number => {
  const measured = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined && Number.isFinite(value)
  const lift =
    measured(evidence.tailDb) && measured(evidence.headDb)
      ? evidence.headDb - evidence.tailDb
      : null

  let score = 0.5
  if (evidence.startsHot) score += 0.25
  if (lift !== null) {
    if (lift >= 3) score += 0.25
    else if (lift <= -3) score -= 0.5
    else if (lift <= -1) score -= 0.25
  }
  return nearestStep(clamp(score, 0.25, 1))
}
