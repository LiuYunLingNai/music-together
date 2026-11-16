import type { AutomixPlanPayload, AutomixTransitionPayload } from '@music-together/shared'

/**
 * PLAYER_PLAY 随包下发的过渡参数。房间内所有成员收到同一个值，
 * 客户端设置里的淡入淡出只在这条消息缺席时兜底。
 *
 * 必须跟着 PLAYER_PLAY 一起消费：服务端随后会为新的一对曲目广播
 * PLAYER_AUTOMIX_PLAN，若在这里共用同一份「最新计划」，接歌时就会读到
 * 下一对曲目的计划而匹配失败。
 */
let pendingTransition: AutomixTransitionPayload | null = null

export const setPendingAutomixTransition = (
  transition: AutomixTransitionPayload | null | undefined,
): void => {
  pendingTransition =
    transition && Number.isFinite(transition.overlapMs) && transition.overlapMs > 0
      ? transition
      : null
}

export const takePendingAutomixTransition = (): AutomixTransitionPayload | null => {
  const value = pendingTransition
  pendingTransition = null
  return value
}

/**
 * 服务端排定的过渡落点（PLAYER_AUTOMIX_PLAN）。分轨准备要按同一组
 * overlap / outStart 选窗口，否则 key 对不上、只能退回普通淡化。
 */
let pendingPlan: AutomixPlanPayload | null = null

export const setPendingAutomixPlan = (plan: AutomixPlanPayload | null): void => {
  pendingPlan = plan
}

export const getPendingAutomixPlan = (): AutomixPlanPayload | null => pendingPlan

export const takePendingAutomixPlan = (): AutomixPlanPayload | null => {
  const value = pendingPlan
  pendingPlan = null
  return value
}
