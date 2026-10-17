/**
 * 歌单架悬停召唤包络 —— 上游 `04-shelf/00-layout-hover.js` 的
 * `shelfHoverCue` / `shelfVisibility` / `shelfOpenAnimAt` 三件套。
 *
 * ★★★ 先读这一段：上游的悬停召唤在出厂配置下**根本不会触发**。
 *
 *   `canShowShelfHoverCueAt`（00-layout-hover.js:110）第三行是
 *
 *       if (!shelfHoverCue.guide) return false;
 *
 *   而 `guide` 只由 `setShelfGuideCueActive` 写（:131），唯一调用方是
 *   首次运行的新手引导 `prepareVisualGuideStep`
 *   （09-idle-toast-libraries.js:625，`step.target === 'shelf'` 那一步）。
 *   引导结束即 `setShelfGuideCueActive(false)`（:770）。
 *
 *   于是出厂态（`shelf: 'side'` + `shelfPresence: 'auto'` +
 *   `shelfPinnedOpen: false`）下：`cueVis` 恒 0 → `targetVis` 恒 0 →
 *   **歌单架静止态完全不可见，且鼠标移到右缘也不会浮现**。
 *
 *   上游真正的召唤入口是 **画布右键**（05-card-interactions.js:143-170 的
 *   `contextmenu` → `setShelfPinnedOpen(!shelfPinnedOpen)`）：
 *   右键 → `pinnedOpen = true` → `targetVis = 1.0`（整列全不透明浮现）
 *   → 同时 `setFocusZone('shelf-side')` 把相机推到
 *   `radius 4.20 / lookAt.x 2.32`（03-focus-cinema-camera.js:191-197）。
 *   再右键 → `setShelfPinnedOpen(false)` → `shelfVisibility = 0` 硬置零。
 *
 *   ⇒ 本模块移植的"悬停淡入"因此是**上游的死代码路径**。保留它是本项目的
 *     刻意选择（见 `FloatingSongShelf` 的入口说明）：本项目没有右键菜单占位，
 *     且房间场景下右键是浏览器默认菜单。但必须明确记账：
 *     **这不是上游的观感**，上游是"右键开 / 右键关"的硬切 + 相机推近。
 *
 * ============================ 上游状态机 ============================
 *
 * `fx.shelfPresence` 出厂 `'auto'`（00-state/04-fx-defaults.js:154），
 * 因此歌单架**默认隐藏**；以下三层量是 `pinnedOpen` 未开时的推进路径
 * （出厂态下第 1 层恒 0，见上方说明）：
 *
 *   1) `shelfHoverCue.value` —— 指针热区悬停量（0..1）
 *        · `updateShelfHoverCueFromPointer`（:168）在**每个指针事件**上
 *          `target = active ? 1 : 0` —— 进区当帧即起步淡入，离区当帧即归零。
 *        · `tickShelfHoverCue`（:186）里的
 *          `if (now - enteredAt > 260) target = 1` 是对同一个值的**再确认**，
 *          **不是**"先等 260ms 才召唤"的闸门。真正让"指针扫过"不召唤的是
 *          退出同样即时：掠过时只有一点微亮就退回去了。
 *        · `now - lastAt > 650`（:189）是**没有事件可依时**的兜底
 *          （指针冲出窗口、HUD 抢走事件），不是正常路径的收回延迟。
 *        · 每帧 `value += (target - value) * durationEaseFactor(d, dt)`，
 *          其中 d = `target > value ? openDuration × 0.50 : closeDuration × 0.50`
 *          （open 0.91 / close 0.46，出厂见 fx-defaults:178-179）
 *
 *   2) `shelfVisibility` —— 整体透明度系数（0..1）
 *      `01-manager-core.js:767-771`：
 *        · 目标：`(contentOpen || pinnedOpen || alwaysVisible) ? 1
 *                 : (cueVis > 0.01 ? max(0.16, cueVis × 0.88) : 0)`
 *        · 每帧 `visibility += (target - visibility)
 *                  × durationEaseFactor(target > visibility
 *                      ? openDuration × 0.45 : closeDuration × 0.65, dt)`
 *        · `group.visible = appRevealed && (mode !== 'side' || visibility > 0)`
 *
 *   3) `shelfOpenAnimAt` —— 每张卡的 stagger 揭示起点（秒）
 *      `01-manager-core.js:453-455`：
 *        revealRaw = clamp((nowT − shelfOpenAnimAt − absD × 0.035 × stagger)
 *                          / openDuration)
 *        reveal    = revealRaw² × (3 − 2 × revealRaw)      ← smoothstep
 *      `absD` 是该卡与中心的距离，于是整列**从中心向两侧**依次浮现。
 *
 * 这三个量最终都乘进 `card.mesh.material.opacity`（:504）：
 *   min(1, opacity × shelfVisibility × reveal × (1 − paneEase×0.24)
 *          + pulse×0.10×reveal + breathPulse×0.035) × shelfLook.opacity
 *
 * ★★ 为什么必须移植：这不是"锦上添花"的动效，而是**两处下游偏离的根因**。
 *
 *   (a) `SHELF_CENTER.x`。上游出厂 `shelfOffsetX: −0.34`（fx-defaults:158），
 *       本项目因为歌单架常驻可见、按 −0.34 摆放会压住封面盘（卡片左缘
 *       67.4% vs 封面 69.3%），第三十三轮把它改成了 0。上游没这个问题，
 *       正是因为静止态整列不可见。
 *   (b) 歌词缩放。上游 `14-stage-lyrics-rendering.js:2117-2123` 的
 *       `layoutScale *= 0.72` 只在 `shelfLyricAvoid && fx.lyricCameraLock`
 *       同时成立时生效，而 `lyricCameraLock` 出厂 false（:97）——
 *       静止态歌词**不缩**。本项目此前无条件乘 0.72，正是因为歌单架
 *       常驻可见、不缩就真的会撞上。
 *
 *   包络一到位，(a)(b) 都可以回到上游值。
 *
 * ★ `stagger` / `slide` / `scale` / `parallax` / `cameraEnterSpeed` /
 *   `cameraExitSpeed` 出厂值见 `shelfSummonSettings()`
 *   （04-visual-settings-persistence.js:1023-1034）：
 *   0.91 / 0.46 / 1.9 / 1 / 1 / 1 / 0.24 / 0.24。
 *   本项目没有 FX 设置面板，直接固定为出厂值。
 */

/** 上游 `durationEaseFactor`（04-visual-settings-persistence.js:1035-1039）。 */
export function durationEaseFactor(seconds: number, dt: number): number {
  const s = Math.max(0.016, Number(seconds) || 0.016)
  const d = Math.max(1 / 240, Number(dt) || 1 / 60)
  return Math.min(1, Math.max(0.001, 1 - Math.exp(-d / s)))
}

/** 上游 `shelfSummonSettings()` 出厂值。 */
export const SHELF_SUMMON = {
  openDuration: 0.91,
  closeDuration: 0.46,
  slide: 1.9,
  stagger: 1,
  scale: 1,
  parallax: 1,
  cameraEnterSpeed: 0.24,
  cameraExitSpeed: 0.24,
} as const

/** 上游 `shelfHoverCue` 的 260ms 停留门槛（:172）。 */
const CUE_DWELL_MS = 260
/** 上游 `shelfHoverCue` 的 650ms 空闲门槛（:179）。 */
const CUE_IDLE_MS = 650

/**
 * 上游 `shelfHoverCue` 的指针侧子集。
 *
 * 只保留本项目用得到的字段：上游的 `guide`（首次引导）依赖
 * `visualGuideActive` / `emptyHomeActive` 等首页态，本项目没有对应概念，
 * 因此引导分支整体不移植（guide 为 false 时 `target` 完全由热区决定，
 * 正是默认路径）。
 */
export interface ShelfHoverCue {
  /** 指针是否在热区内 */
  zoneActive: boolean
  /** 进入热区的时刻（ms），用于 260ms 停留判定 */
  enteredAt: number
  /** 最后一次指针事件的时刻（ms），用于 650ms 空闲判定 */
  lastAt: number
  /** 悬停目标（0/1） */
  target: number
  /** 悬停当前值（0..1） */
  value: number
}

export function createShelfHoverCue(): ShelfHoverCue {
  return { zoneActive: false, enteredAt: 0, lastAt: 0, target: 0, value: 0 }
}

/**
 * 指针事件入口 —— 上游 `updateShelfHoverCueFromPointer`（:131-155）。
 *
 * 上游还叠了 `shelfPlaybackSwitchGuard`（切歌后 1120ms 内禁止浮现，
 * `markShelfPlaybackSwitchGuard(1120)`，:30 + `suppressShelfPreviewForPlaybackSwitch`）。
 * 本项目**移植了**它：切歌时歌单架中心要硬跳到当前曲目
 * （`centerSmooth = centerTarget`），若不压住召唤，跳变会被看见。
 */
export interface ShelfPointerSample {
  /** 指针屏幕坐标；`null` = 指针已离开画布 */
  x: number
  y: number
  /** 指针是否压在 HUD DOM 上 */
  overUi: boolean
  /** 指针是否在悬停热区内 */
  inZone: boolean
  /** 是否正在拖拽（转物体）—— 拖拽期间不算悬停 */
  rotating: boolean
  /**
   * 最近一次**真实指针事件**的时刻（ms）。`null` = 指针不在画布上。
   *
   * ★ 必须是事件时刻，不能是"读取时刻"。见下方 `updateShelfHoverCue`
   *   对 `lastAt` 的说明 —— 写成当前帧时刻会让 650ms 空闲永不成立。
   */
  movedAt: number | null
}

/** 切歌守卫时长（上游 `markShelfPlaybackSwitchGuard(1120)`）。 */
export const SHELF_SWITCH_GUARD_MS = 1120

export interface ShelfSummonState extends ShelfHoverCue {
  /** 整体透明度系数（上游 `shelfVisibility`，0..1） */
  visibility: number
  /** 每张卡 stagger 揭示的起点时刻（ms，与 `performance.now()` 同源） */
  openAnimAt: number
  /** 切歌守卫截止时刻（ms） */
  switchGuardUntil: number
}

export function createShelfSummonState(): ShelfSummonState {
  return {
    ...createShelfHoverCue(),
    // 上游初值 −10（秒）表示"早已打开完成"，本项目用时刻制：
    // 初值取 `performance.now() − openDuration × 1000` 等价，即首帧就已完成揭示。
    openAnimAt: -SHELF_SUMMON.openDuration * 1000,
    visibility: 0,
    switchGuardUntil: 0,
  }
}

/**
 * 切歌守卫（上游 `suppressShelfPreviewForPlaybackSwitch`，:230-245）：
 * 立刻压掉悬停与可见度，并在 1120ms 内拒绝任何召唤。
 */
export function markShelfPlaybackSwitchGuard(state: ShelfSummonState, now: number): void {
  state.switchGuardUntil = Math.max(state.switchGuardUntil, now + SHELF_SWITCH_GUARD_MS)
  state.target = 0
  state.value = 0
  state.zoneActive = false
  state.enteredAt = 0
  state.visibility = 0
}

/** 上游 `shelfPlaybackSwitchGuardActive`（:10-12）。 */
export function shelfPlaybackSwitchGuardActive(state: ShelfSummonState, now: number): boolean {
  return now < state.switchGuardUntil
}

/**
 * 推进悬停目标 —— 上游 `tickShelfHoverCue`（:169-189）的 `target` 部分。
 *
 * 拆成 `updateShelfHoverCue`（指针事件里调）与 `tickShelfHoverCueValue`
 * （渲染循环里调）两步，是因为本项目的指针位置来自
 * `orbitCameraState.pointerSlot`（CameraRig 写入、 Shelf 读取的共享槽），
 * 不是 DOM 事件回调 —— 没有天然的事件时机。
 */
export function updateShelfHoverCue(state: ShelfSummonState, sample: ShelfPointerSample, now: number): void {
  if (shelfPlaybackSwitchGuardActive(state, now)) {
    state.target = 0
    state.value = 0
    state.zoneActive = false
    state.enteredAt = 0
    return
  }
  // 上游 `canShowShelfHoverCueAt` 的前置条件里有一条 `!isPointerOverUi(e)`；
  // 本项目 `overUi` 已由调用方算出（HUD 判定见 `pointerUiHit.ts`）。
  const canShow = !sample.overUi && !sample.rotating
  const inZone = canShow && sample.inZone
  if (inZone && !state.zoneActive) {
    state.zoneActive = true
    state.enteredAt = now
  } else if (!inZone) {
    state.zoneActive = false
    state.enteredAt = 0
  }
  // ★★ 上游 `00-layout-hover.js:168`：`shelfHoverCue.target = active ? 1 : 0`。
  //
  //   这一行此前**漏移植**了，是「歌单架不会淡出」的直接根因：
  //   `zoneActive` 转假只清掉停留计时，`target` 仍停在 1 ——
  //   而 `tickShelfHoverCueValue` 里唯一能把 `target` 拉回 0 的分支是
  //   650ms 空闲兜底，那条又因为 `lastAt` 每帧被刷新而永不成立（见下）。
  //   于是两道闸门同时失效，整列浮现后就再也收不回去。
  state.target = inZone ? 1 : 0
  // ★ `lastAt` 记的是**最近一次真实指针事件**的时刻。
  //
  //   上游 `lastAt` 只在 DOM mousemove 里被写（:171），`tickShelfHoverCue`
  //   用 `now - lastAt > 650` 判"指针已停止活动"。本项目的指针位置来自
  //   `orbitCameraState.pointerSlot` 这个共享槽、由渲染循环**逐帧**读取，
  //   若在这里写 `now`，等于每帧伪造一次 mousemove —— 空闲量永远累积不到
  //   650ms。因此时刻由事件写入方（CameraRig 的 pointermove）盖戳，
  //   这里只转抄；指针离开画布（`movedAt == null`）时保持上次事件时刻不动，
  //   让空闲计时继续累积。
  if (sample.movedAt != null) state.lastAt = sample.movedAt
}

/**
 * 上游 `tickShelfHoverCue`（:169-189）：先算 `target`，再缓动 `value`。
 */
export function tickShelfHoverCueValue(state: ShelfSummonState, dt: number, now: number): number {
  if (shelfPlaybackSwitchGuardActive(state, now)) {
    state.target = 0
    state.value = 0
    state.zoneActive = false
    state.enteredAt = 0
    return 0
  }
  // 停留判定（上游 :182-188）。
  //
  // ★ 上游在这里**重新验证**热区（`canShowShelfHoverCueAt(heldPointer)`），
  //   不通过就把 `zoneActive`/`enteredAt`/`target` 一起清零 —— 因为上游只有
  //   指针事件才更新状态，指针静止而**热区本身变了**（视口 resize、HUD
  //   弹出盖住指针）时没有事件可依。本项目逐帧调 `updateShelfHoverCue`，
  //   热区变化下一帧即被重算，故此处无需重复验证；但 `target` 的收回
  //   必须保留（见 `updateShelfHoverCue` 里的 `state.target = inZone ? 1 : 0`）。
  if (state.zoneActive) {
    if (now - state.enteredAt > CUE_DWELL_MS) state.target = 1
  } else if (now - state.lastAt > CUE_IDLE_MS) {
    // 上游 :189：离开热区且 650ms 无新事件 —— 兜底收回。
    state.target = 0
  }
  const duration =
    state.target > state.value
      ? SHELF_SUMMON.openDuration * 0.5
      : SHELF_SUMMON.closeDuration * 0.5
  state.value += (state.target - state.value) * durationEaseFactor(duration, dt)
  if (state.value < 0.006 && !state.target) state.value = 0
  return state.value
}

/**
 * 上游 `01-manager-core.js:758-771` 的 `shelfVisibility` 推进 +
 * `group.visible` 门控。
 *
 * `hasItems` 对应上游 `allItems.length`（无卡片时目标恒 0）。
 * 本项目没有 `contentOpen` / `pinnedOpen` / `shelfAlwaysVisible()`
 * （无详情面板、无固定开关、无 always 档），因此目标只有两档：
 *   cue > 0.01 → max(0.16, cue × 0.88)   ／  0
 */
export function tickShelfVisibility(
  state: ShelfSummonState,
  dt: number,
  hasItems: boolean,
): { visibility: number; visible: boolean } {
  const target = hasItems && state.value > 0.01 ? Math.max(0.16, state.value * 0.88) : 0
  const duration =
    target > state.visibility ? SHELF_SUMMON.openDuration * 0.45 : SHELF_SUMMON.closeDuration * 0.65
  state.visibility += (target - state.visibility) * durationEaseFactor(duration, dt)
  if (state.visibility < 0.01 && target === 0) state.visibility = 0
  return { visibility: state.visibility, visible: hasItems && state.visibility > 0 }
}

/**
 * 上游 `shouldAvoidStageLyricsForShelf`（03-focus-cinema-camera.js:170-176）。
 *
 * 这是歌词 `layoutScale *= 0.72` 的唯一开关。上游四个条件里：
 * `shelfAlwaysVisible()` / `shelfPinnedOpen` 本项目恒 false，
 * `hasOpenContent()` 无对应物，因此只剩
 * `shelfVisibility > 0.24 || hoverCue.value > 0.28` 这一条真实分支。
 */
export function shouldAvoidStageLyricsForShelf(state: ShelfSummonState): boolean {
  return state.visibility > 0.24 || state.value > 0.28
}

/**
 * 上游 `isSideShelfFocusHit`（05-card-interactions.js:13-21）里的
 * `shelfVisibility > 0.34` 门槛。
 *
 * 本项目此前因为歌单架常驻可见，不得不在 `FloatingSongShelf` 里补了一条
 * 「拖拽期间禁止跟拍」的显式守卫来防误触（登记为 §2 D11）。包络到位后，
 * 这个隐含门槛自然恢复 —— 未浮现时 `visibility` 为 0，跟拍入口根本不成立。
 */
export function shelfFocusEntryUnlocked(state: ShelfSummonState): boolean {
  return state.visibility > 0.34
}

/**
 * 单张卡的 stagger 揭示量 —— 上游 `01-manager-core.js:453-455`。
 *
 * @param state  包络状态
 * @param now    当前时刻（ms，`performance.now()` 同源）
 * @param absD   该卡与列中心的距离（格）
 */
export function shelfCardReveal(state: ShelfSummonState, now: number, absD: number): number {
  const raw = Math.max(
    0,
    Math.min(
      1,
      (now - state.openAnimAt - absD * 0.035 * SHELF_SUMMON.stagger) / (SHELF_SUMMON.openDuration * 1000),
    ),
  )
  return raw * raw * (3 - 2 * raw)
}

/** 上游 `shelfLook.opacity`（`shelfSettings().opacity`，出厂 1）。 */
export const SHELF_LOOK_OPACITY = 1

/**
 * 跨组件发布槽 —— 与 `shared/audioNormalize.ts` 的 `published` 同款模式。
 *
 * `FloatingSongShelf`（持有包络状态）与 `LyricStage`（要读它来决断歌词缩放）
 * 是**兄弟组件**，且歌单架可能根本没挂载（无队列时）。用 props 穿四层
 * 会把"歌单架未挂载"变成"歌词拿不到默认值"的隐式耦合；用一个模块级
 * 发布槽则天然收敛到"未挂载 = 隐藏态"。
 *
 * ★ 模块级单例的清理义务：这是可变状态，歌单架卸载时必须写回隐藏态，
 *   否则下次进入视觉模式会带着上一次的 `visibility` 直接浮现。
 */
const published: { avoidLyrics: boolean; visibility: number } = {
  avoidLyrics: false,
  visibility: 0,
}

/** 歌单架每帧发布避让状态（`FloatingSongShelf` 调）。 */
export function publishShelfLyricAvoid(avoid: boolean, visibility: number): void {
  published.avoidLyrics = avoid
  published.visibility = visibility
}

/** 歌词侧读取（`LyricStage` 调）。歌单架未挂载时为隐藏态 → 不避让。 */
export function readShelfLyricAvoid(): boolean {
  return published.avoidLyrics
}

