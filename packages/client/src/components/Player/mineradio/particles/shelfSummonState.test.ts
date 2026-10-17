import { describe, expect, it } from 'vitest'
import {
  createShelfSummonState,
  durationEaseFactor,
  markShelfPlaybackSwitchGuard,
  publishShelfLyricAvoid,
  readShelfLyricAvoid,
  shelfCardReveal,
  shelfFocusEntryUnlocked,
  shelfPlaybackSwitchGuardActive,
  SHELF_SWITCH_GUARD_MS,
  shouldAvoidStageLyricsForShelf,
  tickShelfHoverCueValue,
  tickShelfVisibility,
  updateShelfHoverCue,
  type ShelfPointerSample,
  type ShelfSummonState,
} from './shelfSummonState'

/**
 * 回归：歌单架悬停召唤包络（上游 `04-shelf/00-layout-hover.js` +
 * `01-manager-core.js:758-771` / `:453-455`）。
 *
 * 这个包络是两处下游偏离的**根因**，移植后必须钉住三条不变量：
 *
 *   ① 静止态整列不可见（`visibility === 0`）—— 否则 `SHELF_CENTER.x`
 *      回到上游 −0.34 后会压住封面盘。
 *   ② 260ms 停留门槛必须真的拦住"扫过"—— 否则指针划过右缘就会召唤。
 *   ③ 浮现到 `visibility > 0.34` 才解锁跟拍（上游 `isSideShelfFocusHit`）。
 *
 * 断言用**真实取值遍历**，不匹配源码文本。
 */

const STEP_MS = 16
/**
 * `movedAt: null` = 「本帧没有新的指针事件」。
 *
 * 这些样本被 `advance()` 逐帧复用，而 `advance` 的语义是"指针停在原处"——
 * 停住就不会再有 pointermove。`updateShelfHoverCue` 因此不会刷新 `lastAt`，
 * 空闲计时能真实累积（见下方 `advanceIdle` 与 `movedAt` 的说明）。
 * 需要模拟"指针确实在动"的用例自己传 `movedAt: clock.now`。
 */
const SAMPLE_IN_ZONE: ShelfPointerSample = {
  x: 1500,
  y: 400,
  overUi: false,
  inZone: true,
  rotating: false,
  movedAt: null,
}
const SAMPLE_OUT: ShelfPointerSample = {
  x: 800,
  y: 400,
  overUi: false,
  inZone: false,
  rotating: false,
  movedAt: null,
}

/**
 * 测试时钟。
 *
 * 上游的 `shelfHoverCue.lastAt` 语义是「最后一次**指针事件**的时刻」——
 * 只有 `updateShelfHoverCueFromPointer` 会写它，逐帧的 `tickShelfHoverCue`
 * 只读。因此"指针离开后 650ms 收回"这个行为，**必须**有一个持续前进的
 * 时钟才能测出来：若每帧都伪造一次指针事件，`lastAt` 永远被刷新，
 * 空闲门槛永远跨不过去。
 *
 * 这里显式持有 `now`，把"发事件"与"推进时间"两件事分开。
 */
interface Clock {
  now: number
}

function createClock(): Clock {
  return { now: 0 }
}

/** 推进 `ms` 毫秒，每帧都发一次指针事件（指针在动 / 静止在热区内）。 */
function advance(state: ShelfSummonState, ms: number, sample: ShelfPointerSample, clock: Clock): void {
  for (let t = 0; t < ms; t += STEP_MS) {
    clock.now += STEP_MS
    updateShelfHoverCue(state, sample, clock.now)
    tickShelfHoverCueValue(state, STEP_MS / 1000, clock.now)
    tickShelfVisibility(state, STEP_MS / 1000, true)
  }
}

/**
 * 推进 `ms` 毫秒但**不发指针事件**（指针已离开画布 / 完全静止）。
 *
 * ★ 不得回写 `state.lastAt`：没有事件就不该动它。写回去等于每帧都伪造
 *   一次 pointermove，650ms 空闲门槛永远跨不过去。
 */
function advanceIdle(state: ShelfSummonState, ms: number, clock: Clock): void {
  for (let t = 0; t < ms; t += STEP_MS) {
    clock.now += STEP_MS
    tickShelfHoverCueValue(state, STEP_MS / 1000, clock.now)
    tickShelfVisibility(state, STEP_MS / 1000, true)
  }
}

describe('durationEaseFactor（上游 04-visual-settings-persistence.js:1035-1039）', () => {
  it('是 (0,1] 区间内的指数趋近系数', () => {
    const f = durationEaseFactor(0.5, 1 / 60)
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThanOrEqual(1)
  })

  it('dt 越大系数越大（同秒数下更快收敛）', () => {
    expect(durationEaseFactor(0.5, 0.1)).toBeGreaterThan(durationEaseFactor(0.5, 1 / 240))
  })

  it('dt 被夹到 ≥1/240，秒数被夹到 ≥0.016（不会除零/NaN）', () => {
    expect(Number.isFinite(durationEaseFactor(0, 0))).toBe(true)
  })
})

describe('悬停召唤 · 静止态', () => {
  it('① 初始整列不可见，且不避让歌词', () => {
    const state = createShelfSummonState()
    const { visible } = tickShelfVisibility(state, 1 / 60, true)
    expect(state.visibility).toBe(0)
    expect(visible).toBe(false)
    expect(shouldAvoidStageLyricsForShelf(state)).toBe(false)
    expect(shelfFocusEntryUnlocked(state)).toBe(false)
  })

  it('无内容（空队列）时即使有悬停也不可见', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 2000, SAMPLE_IN_ZONE, clock)
    // 悬停量确实上去了，但 hasItems=false → 可见度目标恒 0
    expect(state.value).toBeGreaterThan(0.9)
    // ★ 可见度是**衰减**到 0 的，不是一帧置零（上游同样是
    //   `visibility += (target - visibility) * factor`）。衰减足够多帧后
    //   低于上游的 0.01  snapping 阈值 → 精确归零。
    for (let i = 0; i < 120; i++) tickShelfVisibility(state, 1 / 60, false)
    expect(state.visibility).toBeLessThan(0.01)
    expect(state.visibility).toBe(0) // snapping 后精确为 0
    expect(tickShelfVisibility(state, 1 / 60, false).visible).toBe(false)
  })
})

describe('悬停召唤 · 进入与退出', () => {
  /**
   * ★ 这条此前钉的也是**错的**：「停留不足 260ms 则 `value` 恒为 0」。
   *
   *   上游 `:168` 在**每个指针事件**上就把 `target = active ? 1 : 0`，
   *   因此进区**当帧**淡入就已开始；`tickShelfHoverCue:186` 里那句
   *   `if (now - enteredAt > 260) target = 1` 只是对同一个值的**再确认**，
   *   并不构成"先等 260ms"的闸门。
   *
   *   真正阻止"扫过即召唤"的是**退出同样即时**：指针划出热区当帧
   *   `target` 归零，淡入量以 `closeDuration × 0.50` 退回 —— 观感是
   *   边缘掠过时一点微亮，而不是整列浮现。
   */
  it('进区当帧即开始淡入（上游 :168，无 260ms 闸门）', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 200, SAMPLE_IN_ZONE, clock)
    expect(state.value, '进区即起步').toBeGreaterThan(0)
    expect(state.value, '200ms 还远未收敛').toBeLessThan(0.75)
  })

  it('扫过（进区 100ms 后立刻离开）会退回 0', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 100, SAMPLE_IN_ZONE, clock)
    const peak = state.value
    expect(peak).toBeGreaterThan(0)
    // `value` 与 `visibility` 是**两级**缓动：前者 closeDuration×0.50、
    // 后者 ×0.65，且后者的输入是前者。因此可见度总比悬停量**晚**收敛，
    // 不能在同一帧上断言两者都已归零。
    advance(state, 900, SAMPLE_OUT, clock)
    expect(state.value, '离开后悬停量应退回 0').toBe(0)
    advance(state, 600, SAMPLE_OUT, clock)
    expect(state.visibility, '可见度随后收敛到 0').toBe(0)
  })

  it('停留超过 260ms 后开始淡入，最终收敛到 >0.24', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 400, SAMPLE_IN_ZONE, clock)
    expect(state.value).toBeGreaterThan(0)
    advance(state, 1200, SAMPLE_IN_ZONE, clock)
    // cueVis × 0.88 是 visibility 的目标，cue 收敛到 1 → 0.88
    expect(state.visibility).toBeGreaterThan(0.24)
    expect(state.visibility).toBeLessThanOrEqual(0.88)
  })

  it('停留门槛只在**状态翻转**时重新计时（同状态持续不重置）', () => {
    const state = createShelfSummonState()
    let now = 0
    now += STEP_MS
    updateShelfHoverCue(state, SAMPLE_IN_ZONE, now)
    const enteredAt = state.enteredAt
    // 250ms 的重复 inZone 事件**不得**把进入时刻清零
    for (let t = 0; t < 250; t += STEP_MS) {
      now += STEP_MS
      updateShelfHoverCue(state, SAMPLE_IN_ZONE, now)
      tickShelfHoverCueValue(state, STEP_MS / 1000, now)
    }
    expect(state.enteredAt, '同状态持续不应重置进入时刻').toBe(enteredAt)
    expect(now - state.enteredAt).toBeGreaterThan(240)
  })
})

describe('悬停召唤 · 收回（上游 :168 立即 + :189 空闲兜底）', () => {
  /**
   * ★ 这一组此前钉的是**错的**语义：「离开热区后要等 650ms 才收回」。
   *
   *   上游 `updateShelfHoverCueFromPointer:168` 是
   *   `shelfHoverCue.target = active ? 1 : 0` —— 只要还有指针事件，
   *   离开热区**当帧**就把目标归零；`tickShelfHoverCue:189` 的
   *   `now - lastAt > 650` 是**没有事件可依时**的兜底（指针冲出窗口、
   *   HUD 抢走事件），不是正常路径的延迟。
   *
   *   钉错的代价正是用户报告的「歌单架不会淡出」：当时 `:168` 整条漏移植，
   *   收回只剩 650ms 兜底一条路，而它又因 `lastAt` 每帧被刷新而永不成立。
   */
  it('离开热区当帧即收回 target（上游 :168）', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 1500, SAMPLE_IN_ZONE, clock)
    expect(state.target).toBe(1)
    clock.now += STEP_MS
    updateShelfHoverCue(state, SAMPLE_OUT, clock.now)
    expect(state.zoneActive).toBe(false)
    expect(state.target, '离开热区应立即归零').toBe(0)
  })

  it('指针冲出画布后靠 650ms 空闲兜底收回（上游 :189）', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    // 指针在区内时**确实在动**：每帧盖真实事件戳，lastAt 随之前进
    for (let t = 0; t < 1500; t += STEP_MS) {
      clock.now += STEP_MS
      updateShelfHoverCue(state, { ...SAMPLE_IN_ZONE, movedAt: clock.now }, clock.now)
      tickShelfHoverCueValue(state, STEP_MS / 1000, clock.now)
      tickShelfVisibility(state, STEP_MS / 1000, true)
    }
    expect(state.target).toBe(1)
    // 之后一个事件都没有（指针已不在画布上），只有时间推进。
    // zoneActive 仍为 true —— 兜底分支要求 !zoneActive，故先模拟
    // 「最后一次事件之后指针再无动静」：热区判定在下一帧即转假。
    clock.now += STEP_MS
    updateShelfHoverCue(state, SAMPLE_OUT, clock.now)
    state.target = 1 // 还原成"目标还没来得及归零"的兜底前提
    advanceIdle(state, 500, clock)
    expect(state.target, '650ms 内兜底不触发').toBe(1)
    advanceIdle(state, 400, clock)
    expect(state.target, '越过 650ms 空闲应收回').toBe(0)
  })

  it('指针静止在热区内**不会**被 650ms 收回（持续事件刷新 lastAt）', () => {
    const state = createShelfSummonState()
    // 持续喂同一个 inZone 事件（指针静止但仍在发 pointermove）
    const clock = createClock()
    advance(state, 3000, SAMPLE_IN_ZONE, clock)
    expect(state.target, '静止在热区内应保持召唤').toBe(1)
  })

  it('指针在 HUD 上时不算悬停（上游 canShowShelfHoverCueAt 的 isPointerOverUi）', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 1500, { ...SAMPLE_IN_ZONE, overUi: true }, clock)
    expect(state.target).toBe(0)
    expect(state.value).toBe(0)
  })

  it('拖拽期间不算悬停（拖拽手势不该召唤歌单架）', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 1500, { ...SAMPLE_IN_ZONE, rotating: true }, clock)
    expect(state.target).toBe(0)
    expect(state.value).toBe(0)
  })
})

describe('跟拍解锁门槛（上游 isSideShelfFocusHit 的 visibility > 0.34）', () => {
  it('③ 未浮现时跟拍入口不成立', () => {
    const state = createShelfSummonState()
    expect(shelfFocusEntryUnlocked(state)).toBe(false)
  })

  it('浮现到 >0.34 后解锁', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 1500, SAMPLE_IN_ZONE, clock)
    expect(state.visibility).toBeGreaterThan(0.34)
    expect(shelfFocusEntryUnlocked(state)).toBe(true)
  })
})

describe('歌词避让（上游 shouldAvoidStageLyricsForShelf）', () => {
  it('静止态不避让 → 歌词保持完整尺寸', () => {
    const state = createShelfSummonState()
    publishShelfLyricAvoid(shouldAvoidStageLyricsForShelf(state), state.visibility)
    expect(readShelfLyricAvoid()).toBe(false)
  })

  it('浮现到 visibility > 0.24 时避让', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 1500, SAMPLE_IN_ZONE, clock)
    expect(state.visibility).toBeGreaterThan(0.24)
    expect(shouldAvoidStageLyricsForShelf(state)).toBe(true)
  })

  it('发布槽可跨组件传递（兄弟组件桥接）', () => {
    publishShelfLyricAvoid(true, 0.5)
    expect(readShelfLyricAvoid()).toBe(true)
    publishShelfLyricAvoid(false, 0)
    expect(readShelfLyricAvoid()).toBe(false)
  })
})

describe('切歌守卫（上游 markShelfPlaybackSwitchGuard / suppressShelfPreviewForPlaybackSwitch）', () => {
  it('切歌立刻压掉悬停与可见度，并在 1120ms 内拒绝召唤', () => {
    const state = createShelfSummonState()
    const clock = createClock()
    advance(state, 1500, SAMPLE_IN_ZONE, clock)
    expect(state.visibility).toBeGreaterThan(0)
    const t0 = state.lastAt
    markShelfPlaybackSwitchGuard(state, t0)
    expect(state.value).toBe(0)
    expect(state.visibility).toBe(0)
    expect(shelfPlaybackSwitchGuardActive(state, t0 + 100)).toBe(true)
    expect(shelfPlaybackSwitchGuardActive(state, t0 + SHELF_SWITCH_GUARD_MS + 1)).toBe(false)
  })

  it('守卫期间悬停推进被短路（不会浮现）', () => {
    const state = createShelfSummonState()
    const t0 = 0
    markShelfPlaybackSwitchGuard(state, t0)
    const clock = createClock()
    advance(state, 500, SAMPLE_IN_ZONE, clock)
    expect(state.value).toBe(0)
    expect(state.visibility).toBe(0)
  })
})

describe('stagger 揭示（上游 01-manager-core.js:453-455）', () => {
  it('初始态（openAnimAt 为负）所有卡都已揭示完', () => {
    const state = createShelfSummonState()
    // `openAnimAt = -openDuration*1000`，absD=5 时还要再扣 5×35ms 的 stagger，
    // 因此中心卡严格等于 1、边缘卡在浮点误差内等于 1。
    expect(shelfCardReveal(state, 0, 0)).toBe(1)
    expect(shelfCardReveal(state, 0, 5)).toBeCloseTo(1, 6)
  })

  it('同一时刻，离中心越远的卡揭示越少（从中心向两侧展开）', () => {
    const state = createShelfSummonState()
    state.openAnimAt = 0
    const at = 200 // ms
    expect(shelfCardReveal(state, at, 0)).toBeGreaterThan(shelfCardReveal(state, at, 1))
    expect(shelfCardReveal(state, at, 1)).toBeGreaterThan(shelfCardReveal(state, at, 3))
  })

  it('揭示是 smoothstep：单调递增且终值 1', () => {
    const state = createShelfSummonState()
    state.openAnimAt = 0
    let prev = -1
    for (let t = 0; t <= 1200; t += 50) {
      const r = shelfCardReveal(state, t, 0)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
    expect(prev).toBe(1)
  })
})
