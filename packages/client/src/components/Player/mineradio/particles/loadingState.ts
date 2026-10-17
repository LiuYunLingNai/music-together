/**
 * 加载态雾环（上游 `uLoading`，`02-visual/15-ripples-cover-depth.js:375-458`）。
 *
 * ============================ 上游状态机 ============================
 *
 * 上游是**三个模块级变量 + 一个 rAF 补间**：
 *
 *   var loadingTween = null;      // { raf }，非空表示正在补间
 *   var loadingShownAt = 0;       // showLoading 的时刻，用于"最短展示时长"
 *   var loadingHideTimer = null;  // setTimeout 句柄
 *
 *   showLoading(opts)
 *     ├ opts.trackSwitch || opts.seamlessCover
 *     │   → forceLoadingSettled('seamless-track-switch')：直接归零，**不播**
 *     ├ loadingShownAt = now；清掉 pending 的 hideLoading
 *     └ current = uLoading
 *        tweenLoading(max(current, 0.56), current > 0.04 ? 86 : 118)
 *
 *   hideLoading()
 *     ├ elapsed = now - loadingShownAt（从未显示过则为 999）
 *     ├ wait = max(0, 72 - elapsed)          ← **最短展示 72ms**
 *     └ setTimeout(wait):
 *         current = uLoading
 *         if (current <= 0.015) { 取消补间; uLoading = 0; return }
 *         tweenLoading(0, current > 0.38 ? 126 : 96)
 *
 *   tweenLoading(to, ms, onComplete)
 *     ├ 取消上一个补间的 raf
 *     ├ 后台隐藏 / 深度背景模式 → 直接落位并回调
 *     └ rAF：`value = from + (to - from) * visualEase(t)`，t = (now-start)/ms
 *
 *   visualEase(t) = clamp01(t)² × (3 - 2·clamp01(t))     ← smoothstep
 *
 * ============================ 为什么必须移植 ============================
 *
 * 着色器侧的雾状微尘流（`particleVertex.ts:515-547`，上游
 * `00-pointer-cover-particles.js:929-973`）**已经逐行对齐**：粒子按
 * `mix(pos, mistPos, uLoading)` 聚成一层缓慢漂浮的雾尘，颜色、亮度、
 * 透明度、点尺寸全部随 uLoading 混合。但 `uniforms.uLoading.value` 从来
 * 没有任何写入方 —— 恒为 0，于是 `if (uLoading > 0.001)` 永不成立，
 * 整段代码是死代码。表现为**切歌/加载过程中粒子层毫无反应**：上游此刻
 * 会短暂聚成雾环表示"正在加载"，本项目只是静止地停在原处。
 *
 * ★ 本项目与上游的差异（刻意，且只此一处）：
 *
 *   上游 `showLoading({ trackSwitch: true, seamlessCover: true })`
 *   （13-playback-start-audio.js:1145）走的是 `forceLoadingSettled` 分支
 *   —— **无缝切歌不播加载态**。本项目没有无缝切歌路径（队列续播之间
 *   有网络往返），因此这条分支在本项目恒不命中，不需要移植。
 *   真正需要的是 `showLoading()` 的**无参**形态（06-lyrics/03-podcast-
 *   playlist-loaders.js:39,71）与 `hideLoading()`。
 *
 * ============================ 驱动源 ============================
 *
 * 上游的调用方分两类：
 *
 *   1) `05-playback/14-player-controls.js` 的 5 处 `hideLoading()` ——
 *      播放控制动作（播放/暂停/跳转/停止）后撤掉加载态。
 *   2) `06-lyrics/03-podcast-playlist-loaders.js` 的
 *      `showLoading()` … `finally { hideLoading() }` —— 播单列表加载期间
 *      显示加载态。
 *
 * 本项目的对应物是**音频缓冲**：Howl 的 `load` 完成前视觉层没有可播放的
 * 内容，这正是上游 `showLoading` 想表达的"正在取内容"。因此这里以
 * 缓冲区间驱动（`showLoading()` / `hideLoading()` 成对），
 * 而不是照搬上游的具体按钮回调。
 */

/** 上游 `showLoading` 的淡入目标（`15-ripples-cover-depth.js:421`）。 */
export const LOADING_PEAK = 0.56

/** 上游 `showLoading` 的两档淡入时长（:421）。 */
export const LOADING_FADE_IN_MS = { fast: 86, slow: 118 }
/** 两档的分界：当前值已 > 0.04 视为"已在显示中"，用快速档。 */
const LOADING_FAST_THRESHOLD = 0.04

/** 上游 `hideLoading` 的最短展示时长（:429）。 */
export const LOADING_MIN_HOLD_MS = 72

/** 上游 `hideLoading` 的两档淡出时长（:442）。 */
export const LOADING_FADE_OUT_MS = { long: 126, short: 96 }
/** 两档的分界：当前值 > 0.38 说明"雾环已经完全成形"，退场要更慢。 */
const LOADING_SLOW_THRESHOLD = 0.38

/**
 * 上游 `hideLoading` 里"已经归零就不必再补间"的门槛（:436）。
 *
 * 补间到 0 的过程中如果又调了一次 `hideLoading`，此时值可能已很小；
 * 再起一次 96ms 的补间只会让粒子在几乎看不见的状态下多抖一下。
 */
const LOADING_SETTLED_EPSILON = 0.015

/** 上游 `visualEase`（:381-384）：smoothstep。 */
export function visualEase(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/**
 * 加载态补间状态。
 *
 * ★ 这是**模块级单例**，与 `shelfSummonState` 的发布槽同一模式：
 *   `ParticleField`（持有 uniforms）与 `useHowl`（知道何时在加载）是
 *   兄弟层级，用 props 穿三层会把"粒子层未挂载"变成"没有加载态可读"的
 *   隐式耦合。用单例则天然收敛到"未挂载 = 不显示"。
 *
 * ★ 清理义务（红线 22）：`active` 为真时若舞台被卸载，rAF 补间会在
 *   卸载后继续写 `value` —— 下次进入视觉模式会带着上次的残留值浮现。
 *   因此 `resetLoadingState()` 必须在粒子层卸载时调用。
 */
export interface LoadingState {
  /** 当前值 0..1，逐帧写入 `uniforms.uLoading.value`。 */
  value: number
  /** 是否处于"已请求显示"状态（上游 `loadingShownAt !== 0`）。 */
  active: boolean
  /** 补间目标；`null` = 无补间在飞。 */
  target: number | null
  /** 补间起点时刻（ms）。 */
  startedAt: number
  /** 补间起点值。 */
  from: number
  /** 补间时长（ms）。 */
  durationMs: number
  /** `showLoading` 的时刻（ms），0 = 从未显示。 */
  shownAt: number
  /** `hideLoading` 的 setTimeout 句柄。 */
  hideTimer: ReturnType<typeof setTimeout> | null
}

export function createLoadingState(): LoadingState {
  return {
    value: 0,
    active: false,
    target: null,
    startedAt: 0,
    from: 0,
    durationMs: 0,
    shownAt: 0,
    hideTimer: null,
  }
}

const state = createLoadingState()

/** 读取单例（`ParticleField` 每帧采样 `value`）。 */
export function getLoadingState(): LoadingState {
  return state
}

/**
 * 上游 `tweenLoading(to, durationMs)`（:385-406）的本项目等价物。
 *
 * 与上游的两处差异都是必要的：
 *
 *   ① 上游用**独立的 rAF 循环**推进补间。本项目已经有一个每帧渲染循环
 *      （R3F 的 `useFrame`），再开一个 rAF 会在掉帧时与渲染循环错位，
 *      表现为雾环"一跳一跳"。因此这里只**装配**补间参数，由
 *      `stepLoading(now)` 在渲染循环里推进 —— 数学完全相同。
 *   ② 上游的"后台隐藏/深度背景模式直接落位"分支没有对应物
 *      （本项目的舞台在后台时整帧不渲染，见 `PausedFramePump`）。
 */
export function tweenLoading(to: number, durationMs: number): void {
  if (state.hideTimer) {
    clearTimeout(state.hideTimer)
    state.hideTimer = null
  }
  state.from = state.value
  state.target = to
  state.startedAt = performance.now()
  state.durationMs = Math.max(1, durationMs || 1)
}

/**
 * 上游 `showLoading(opts)`（:409-422）的**无参**形态。
 *
 * 上游带 `trackSwitch` / `seamlessCover` 时会走 `forceLoadingSettled`
 * （不播），本项目没有无缝切歌路径，故不提供该参数。
 */
export function showLoading(): void {
  state.active = true
  state.shownAt = performance.now()
  if (state.hideTimer) {
    clearTimeout(state.hideTimer)
    state.hideTimer = null
  }
  const current = state.value
  tweenLoading(Math.max(current, LOADING_PEAK), current > LOADING_FAST_THRESHOLD ? LOADING_FADE_IN_MS.fast : LOADING_FADE_IN_MS.slow)
}

/**
 * 上游 `hideLoading()`（:423-443）。
 *
 * ★ 最短展示 72ms 是**必须**的：加载可能在 10ms 内完成（本地缓存命中），
 *   没有最短展示时长时雾环会以几乎不可见的幅度闪一下，观感是"画面抖了
 *   一下"而不是"加载过了"。
 */
export function hideLoading(): void {
  if (state.hideTimer) clearTimeout(state.hideTimer)
  const elapsed = state.shownAt ? performance.now() - state.shownAt : 999
  const wait = Math.max(0, LOADING_MIN_HOLD_MS - elapsed)
  state.hideTimer = setTimeout(() => {
    state.hideTimer = null
    const current = state.value
    if (current <= LOADING_SETTLED_EPSILON) {
      // 已归零：撤掉补间并硬置 0（上游同一分支）
      state.target = null
      state.value = 0
      state.active = false
      return
    }
    state.active = false
    tweenLoading(0, current > LOADING_SLOW_THRESHOLD ? LOADING_FADE_OUT_MS.long : LOADING_FADE_OUT_MS.short)
  }, wait)
}

/**
 * 推进补间 —— 上游 `tweenLoading` 的 rAF 回调体（:396-404）。
 *
 * 由 `ParticleField` 的 `useFrame` 每帧调用一次（`now` 用
 * `performance.now()`，与 `startedAt` 同源）。
 */
export function stepLoading(now: number): number {
  if (state.target == null) return state.value
  const raw = Math.min(1, (now - state.startedAt) / state.durationMs)
  const eased = visualEase(raw)
  state.value = state.from + (state.target - state.from) * eased
  if (raw < 1) return state.value
  // 补间完成（上游 `t < 1` 的 else 支）
  state.value = state.target
  state.target = null
  return state.value
}

/**
 * 无条件归零（上游 `forceLoadingSettled(reason)`，:445-457）。
 *
 * 调用方：舞台卸载、视觉模式切换。上游还会在"后台恢复且音频仍在播"时
 * 调它（`recoverVisualsAfterBackground`，:462），本项目没有对应的后台
 * 恢复路径（后台时整帧暂停），因此只有卸载一处。
 */
export function resetLoadingState(): void {
  if (state.hideTimer) {
    clearTimeout(state.hideTimer)
    state.hideTimer = null
  }
  state.value = 0
  state.active = false
  state.target = null
  state.from = 0
  state.startedAt = 0
  state.durationMs = 0
  state.shownAt = 0
}
