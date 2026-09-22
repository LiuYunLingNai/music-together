/**
 * 舞台「安全区」退让 —— 侧栏（热歌榜 / 聊天）展开时整幅 3D 内容横向让开。
 *
 * ============================ 为什么需要这一层 ============================
 *
 * 经典播放器用 **CSS 内边距** 避让侧栏：`RoomPage` 把面板宽度写进
 * `--mt-player-safe-left/right`，`.mt-player-content` 用
 * `padding-inline-start: max(5%, var(--mt-player-safe-left))` 把内容挤开
 * （`index.css:783-793`）。**这套机制对 WebGL 舞台完全无效** —— 画布是
 * `absolute inset-0`，CSS 内边距不会让相机看到更窄的视锥，面板直接盖在
 * 画面上。
 *
 * 实测（1600×900，聊天面板 320px + 边距）：
 *
 *   视口    面板左缘   歌曲架右缘   被盖住
 *   1366     74.2%      87.3%      **179px**
 *   1600     78.0%      87.3%      **149px**
 *   1920     81.7%      87.3%      **109px**
 *   2560     86.3%      87.3%      28px（几乎不重叠）
 *
 * 上游 Mineradio 是**单机桌面应用、根本没有面板**，因此这里没有可"移植"
 * 的上游机制；只能把经典播放器的内边距语义重新表达为相机侧的横向让位。
 * 登记为 HANDOFF §2 D12。
 *
 * ============================ 为什么是离轴视锥 ============================
 *
 * 最初写的是「沿相机右轴平移机位」。那是**错的**，而且错得不明显：
 * 相机平移是**世界空间**的，而透视投影把世界尺度按深度缩放 —— 同一个
 * 世界位移，在近处（歌曲架 z≈0.98，距相机 7.15）与远处（歌词 z≈2.24，
 * 距相机 5.89）产生的**屏幕**位移并不相等。要让"近处的歌曲架"刚好清开
 * 面板，挑任何单一深度做换算都会给其他深度留下残差（实测挑 lookAt
 * 深度时在 1366 上残差 1.05%、挑架平面深度时 0.04%），且残差随视口变化。
 *
 * 真正的等价物是 **离轴投影矩阵**（off-center frustum，即 CSS
 * `perspective-origin` / 眼睛错切那一族）：只改投影矩阵的 `elements[8]`
 * 一项，等价于把整个视锥横移，**所有深度得到完全相同的 NDC 平移**
 * （实测四个深度 Δ 均为精确的 5.000%）。这正是"内边距"的语义 ——
 * 画面像贴着窗口边被整体推开，而不是像相机平移那样带透视差。
 *
 * 代价：不修改相机位置，因此"看向何处"不变；射线拾取（歌单架卡片命中）
 * 走 `Raycaster.setFromCamera`，它读的是**相机矩阵 + 投影矩阵**，
 * `elements[8]` 会被正确计入，因此命中判定与画面同步偏移，无需另改。
 *
 * ============================ 过渡必须与经典播放器同形 ============================
 *
 * 经典播放器的退让是 `transition: padding-inline-* 200ms ease-out`
 * （`index.css:771-776`），即**滑过去**。最初这里只有静态结果、没有过渡，
 * 开关面板时画面**瞬间跳变** —— 与经典播放器并排一比就是"硬切"。
 *
 * 因此本模块自带缓动（`stepStageSafeArea` 逐帧求值）：
 *   · 时长 **200ms**、曲线 **CSS `ease-out`**（`cubic-bezier(0,0,0.58,1)`），
 *     与经典播放器是同一个值、同一条曲线；
 *   · `prefers-reduced-motion: reduce` 时立即到位（对应 CSS 的 `0.01ms`）；
 *   · 目标变化才重启计时（同值重复调用不动），中途反向从**当前位置**起步 ——
 *     快速连点面板开关不会让画面跳动（与 CSS transition 的插值语义一致）。
 *
 * 不能交给 CSS transition 做：退让量落在 `projectionMatrix` 上，是逐帧被
 * 重建覆盖后重新叠加的，没有可动画的 DOM 属性（见下方顺序说明）。
 */

/**
 * 舞台**构图**的横向范围（屏幕宽度比例）—— **按宽高比实算**，不再写死。
 *
 * ============================ 为什么要改成实算 ============================
 *
 * 第三十三轮这里是一对写死的常量（`0.2996` / `0.9147`），取自一次 1600×900 的
 * 实测。第三十四轮审计发现那**不成立**（§5.4 C1/C2）：
 *
 *   · three 的 `PerspectiveCamera.fov` 是**垂直** FOV ⇒ 固定世界坐标的
 *     **水平**屏幕占比**必然随宽高比变化**。实算同一个卡片列右缘：
 *     aspect 1.00 → 118.1%、1.50 → 95.4%、1.78 → 88.2%、2.00 → 84.0%、2.50 → 77.2%。
 *   · 于是"只让开就够"的判据在**不同窗口形状**下要么让不够（窄窗口：
 *     卡片仍被聊天面板盖住），要么让过头（超宽窗口：整幅内容被推向左）。
 *   · 常量里那个 `0.9147` 还是**过时值** —— 取自已被废弃的 `SHELF_CENTER.x = +0.20`
 *     时代，与同一份代码里 `floatingSongCard.ts` 写的 `89.6%`（x = 0）自相矛盾。
 *
 * 因此这里改为**按当前宽高比与相机基线投影实算**。纯函数、无 three 依赖，
 * 便于单测穷举宽高比。
 *
 * 构图左右端：
 *   · 左端 = 封面盘左缘（`emily` 方盘 ±2.4 world，取 −2.4）
 *   · 右端 = 歌单架卡片列**最右角**（含每张卡的缩放与 `sideRotY` 旋转，
 *            取整列 11 张里最靠右的那个角）
 */

/** 封面盘半径（世界单位）—— `emily` 方盘 ±2.4，构图最左端。 */
export const COVER_HALF_WORLD = 2.4
/** 相机基线（与 `orbitCameraState.MODE_CAMERA` 同源；仅用于构图估算）。 */
export const STAGE_CAMERA_FOV = 45

/** 相机基线：各模式的 `{ radius, phi }`（与 `MODE_CAMERA` 保持一致）。 */
export const STAGE_CAMERA_BASELINES: Record<string, { radius: number; phi: number }> = {
  emily: { radius: 6.6, phi: 0.08 },
  tunnel: { radius: 6.2, phi: 0.03 },
  planet: { radius: 7.0, phi: 0.15 },
  vinyl: { radius: 6.5, phi: 0.04 },
  galaxy: { radius: 6.6, phi: 0.08 },
  topography: { radius: 8.4, phi: 0.18 },
}
/** 找不到时的默认档（横屏粒子档）。 */
export const STAGE_CAMERA_DEFAULT = { radius: 6.6, phi: 0.08 }

/** 卡片平面世界尺寸（与 `floatingSongCard.ts` 的 `PlaneGeometry` 一致）。 */
const CARD_W = 2.05
const CARD_H = 1.025
/** 卡片列几何（与 `applyFloatingSongCardPose` 同源）。 */
const CARD_STEP_X = 0.04
const CARD_STEP_Y = 0.68
const CARD_STEP_Z = 0.17
const CARD_BASE_Z = 0.86 + 0.12
const CARD_ROT_Y = 0.28 - (11 * Math.PI) / 180
const CARD_SHELF_SIZE = 0.92
/** 渲染窗口内最远的卡（`SHELF_MAX_RENDER = 11` ⇒ ±5）。 */
const CARD_HALF_SPAN = 5

/**
 * 把一个**相机空间**点投到屏幕水平占比（0..1）。
 *
 * 手写投影（不引 three）。基线是 `lookAt = 原点`、`theta = 0`：
 *   相机位置 `(0, R·sinφ, R·cosφ)`
 *   right = (1, 0, 0)、up = (0, cosφ, −sinφ)、forward = (0, −sinφ, −cosφ)
 * 令 `d = point − camPos`，则
 *   x_cam  = d·right = d.x
 *   depth  = d·forward = −(d.y·sinφ + d.z·cosφ)   ← 取负才为正（相机看向 −z 侧）
 *   ndc.x  = (x_cam / depth) / (tan(fov/2) · aspect)
 */
function projectScreenX(x: number, y: number, z: number, aspect: number, radius: number, phi: number): number {
  const cy = Math.cos(phi)
  const sy = Math.sin(phi)
  const dx = x
  const dy = y - radius * sy
  const dz = z - radius * cy
  const xCam = dx
  const depth = -(dy * sy + dz * cy)
  if (!(depth > 1e-6)) return Number.NaN
  const halfTan = Math.tan((STAGE_CAMERA_FOV * Math.PI) / 180 / 2)
  const ndcX = xCam / depth / (halfTan * Math.max(1e-6, aspect))
  return (ndcX + 1) / 2
}

export interface StageContentExtent {
  /** 构图左缘（屏幕宽度占比） */
  left: number
  /** 构图右缘（屏幕宽度占比） */
  right: number
}

/**
 * 按宽高比与相机基线**实算**构图横向范围。
 *
 * @param aspect      画布的 宽/高（**不是视口的** —— 画布是舞台盒子）
 * @param shelfColumnX 卡片列中心的世界 x（= `shelfSideX() + SHELF_CENTER.x`）
 * @param mode        视觉模式 id（决定相机基线）
 */
export function projectStageContentExtent(
  aspect: number,
  shelfColumnX: number,
  mode: string = 'emily',
): StageContentExtent {
  const base = STAGE_CAMERA_BASELINES[mode] ?? STAGE_CAMERA_DEFAULT
  const { radius, phi } = base
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9

  // 左端：封面盘左缘（放在构图平面上，z 取 0 —— 封面盘在原点附近）
  const left = projectScreenX(-COVER_HALF_WORLD, 0, 0, safeAspect, radius, phi)

  // 右端：整列 11 张卡里最靠右的那个**角**
  let right = Number.NEGATIVE_INFINITY
  for (let i = -CARD_HALF_SPAN; i <= CARD_HALF_SPAN; i++) {
    const distance = Math.abs(i)
    const scale = (distance < 0.5 ? 1.12 : Math.max(0.55, 1.04 - distance * 0.14)) * CARD_SHELF_SIZE
    const hw = (CARD_W * scale) / 2
    const hh = (CARD_H * scale) / 2
    const cx = shelfColumnX + distance * CARD_STEP_X
    const cyv = -0.2 + -i * CARD_STEP_Y
    const cz = CARD_BASE_Z - distance * CARD_STEP_Z
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        // 绕 Y 轴旋转 sideRotY（与 mesh.rotation.y 同源），再平移到卡片中心
        const lx = sx * hw
        const ly = sy * hh
        const rx = lx * Math.cos(CARD_ROT_Y)
        const rz = lx * -Math.sin(CARD_ROT_Y)
        const v = projectScreenX(cx + rx, cyv + ly, cz + rz, safeAspect, radius, phi)
        if (Number.isFinite(v) && v > right) right = v
      }
    }
  }
  if (!Number.isFinite(right)) right = left

  return { left, right }
}

/**
 * 旧的一对常量 —— **已废弃，仅保留供历史对照**。
 *
 * 它们是单次 1600×900（画布 aspect≈2.15）实测值，在其它窗口形状下不成立
 * （见 `projectStageContentExtent` 顶部说明）。**不要在新的计算里使用。**
 */
export const STAGE_CONTENT_LEFT_LEGACY = 0.2996
export const STAGE_CONTENT_RIGHT_LEGACY = 0.9147

/**
 * 侧栏展开时应把**内容**横向平移多少（正 = 右移，单位 = 屏幕宽度比例）。
 *
 * ★ 语义是「**让开就够，不多移**」，不是"居中"。
 *
 *   最初写的是居中式 `(左内边距 − 右内边距) / (2 × 视口宽)`。那有个致命
 *   问题：构图不以相机轴线为中心（中心在 58.4%），于是"居中"会把整幅
 *   内容右移 —— 实测左栏展开时（**桌面默认就是开着的**）歌单架被从
 *   86.9% 推到 97.2%，反而更容易被右侧聊天面板盖住。方向是反的。
 *
 *   现在改为**求可行位移区间、把 0 夹进去**（最小位移原则）：
 *
 *     内容须满足 `左内边距 ≤ 内容左缘 + Δ` 且 `内容右缘 + Δ ≤ 视口宽 − 右内边距`
 *     ⇒ Δ ∈ [左内边距/W − left, (W − 右内边距)/W − right]
 *
 *   其中 `left`/`right` 由 `projectStageContentExtent()` **按当前宽高比实算**
 *   （第三十四轮修，§5.4 C1/C2 —— 此前是一对写死的常量，在非 16:9 窗口下
 *   会让不够或让过头，且那个常量本身还是过时值）。
 *
 *   区间含 0 ⇒ 不动（左栏展开时正是这样：内容左缘已让开面板）。
 *   区间不含 0 ⇒ 取最近端点，即"刚好清开"的最小位移。
 *
 * @param aspect 画布宽高比（**不是视口**）。省略时退化为旧行为所需的 16:9，
 *   仅供不关心精度的调用方使用；生产路径必须传真实值。
 * @param shelfColumnX 卡片列中心世界 x（`shelfSideX() + SHELF_CENTER.x`）。
 * @param mode 视觉模式（决定相机基线）。
 */
export function resolveStagePanFraction(
  leftInsetPx: number,
  rightInsetPx: number,
  viewportWidthPx: number,
  aspect: number = 16 / 9,
  shelfColumnX: number = 3.18,
  mode: string = 'emily',
): number {
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return 0
  const width = viewportWidthPx
  // 单侧内边距不可能超过整幅视口；夹取后可保证返回值落在 [−1, 1]。
  // 不夹的话，越界的输入（面板恰好等于视口宽等）会算出毫无意义的位移量。
  const clampInset = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(width, value)) : 0)
  const left = clampInset(leftInsetPx)
  const right = clampInset(rightInsetPx)
  if (left === 0 && right === 0) return 0

  const extent = projectStageContentExtent(aspect, shelfColumnX, mode)

  /**
   * ★ **每侧面板只约束自己那一侧**（第三十四轮，配合实算范围）。
   *
   *   为什么必须这样：实算显示卡片列在 16:9 上右缘就到 **100.5%** ——
   *   它是**本来就探出右缘**的（上游同样如此，是一列可滚动的卡片）。
   *   若按"内容必须落在可用区内"的对称写法，那么在**只有左栏**开着时
   *   （右内边距 = 0、可用右界 = 100%）也会算出 −0.5% 的位移 ——
   *   把整幅内容左推半格，而左栏根本盖不到右边的歌单架。
   *
   *   这与已验收的行为冲突（§7 第 33 轮第 3 条明确要求"左侧热歌榜展开时
   *   画面不应移动"），也是无谓抖动。因此改为：**右侧面板只管右缘、
   *   左侧面板只管左缘**；没有面板的那一侧不产生约束。
   */
  const clampPan = (v: number) => Math.max(-1, Math.min(1, v))

  // 右侧面板：内容右缘不得越入面板 ⇒ 必要时左移（取最小左移量）
  if (right > 0) {
    const maxShift = (width - right) / width - extent.right
    if (maxShift < 0) return clampPan(maxShift)
  }
  // 左侧面板：内容左缘不得被面板盖住 ⇒ 必要时右移（取最小右移量）
  if (left > 0) {
    const minShift = left / width - extent.left
    if (minShift > 0) return clampPan(minShift)
  }
  // 两侧都不越界（或只有一侧且未越界）⇒ 不动
  return 0
}

/**
 * 把「内容平移比例」换算成**投影矩阵 `elements[8]` 的增量**。
 *
 * three.js 的 `makePerspective` 把 `elements[8]` 置为 `(right+left)/(right−left)`
 * （即 `2·cx`，对称视锥时恰为 0）。它在 `clip.x = e0·x + e8·z` 里乘的是 `z`，
 * 而 `clip.w = −z`，因此
 *
 *     ndc.x = e0·x/(−z) + e8·z/(−z) = 正常 ndc.x − e8
 *
 * 即 **`ndc.x` 随 `elements[8]` 增大而线性减小，且与深度无关** —— 这正是
 * 我们想要的"所有深度平移量相同"（见文件头实测）。
 *
 * 屏幕比例 `Δ`（NDC 是 −1..1，故 `Δndc.x = 2Δ`）要求 `−Δe8 = 2Δ`，
 * 即 `Δe8 = −2Δ`。
 *
 * ★ 取负号：`elements[8]` 增大会把画面推向**左**，而 `Δ > 0` 表示内容要
 *   **右**移（左栏展开那种情形），两者反向。
 */
export function stageProjectionShiftX(panFraction: number): number {
  // `-2 * 0` 得到 `-0`，在 `Object.is` 下不等于 `0`，会让"无位移"的断言
  // 与下游的 `!== 0` 快速路径判断都变得难以捉摸 —— 显式归零。
  if (!Number.isFinite(panFraction) || panFraction === 0) return 0
  return -2 * panFraction
}

/**
 * 退让过渡时长（毫秒）—— 取自**经典播放器**的同一条动效。
 *
 * `.mt-player-content` 是 `transition: padding-inline-* 200ms ease-out`
 * （`index.css:771-776`）。本项目的 3D 退让**必须复刻这个时长与曲线**：
 * 最初只抄了"让开多少"的静态结果、没抄过渡，于是开关面板时画面**瞬间跳变**，
 * 与经典播放器一对比就是"硬切"。用户点出后才补上。
 */
export const STAGE_PAN_DURATION_MS = 200

/** `prefers-reduced-motion` 下的时长（与 CSS 的 `0.01ms` 同义：立即到位）。 */
export const STAGE_PAN_REDUCED_MS = 0.01

/**
 * CSS `ease-out` = `cubic-bezier(0, 0, 0.58, 1)`。
 *
 * 与 `.mt-player-content` 的 `ease-out` 关键字**同一个贝塞尔** —— 用户看到的
 * 是"快速启动、尾部收缓"的滑入，不是线性匀速（线性看起来像机械位移）。
 *
 * 实现为三次贝塞尔求值：先按 x 分量二分求参数 `u`，再取该 `u` 的 y 分量。
 *
 * ★ 二分次数必须是 **20**，不能图省事用 8：过渡只有 0.2s（十几帧），
 *   单帧求值成本可以忽略，但 8 次二分的分辨率只有 1/256，实测在 `t=0.1`
 *   处已偏离真值 **0.003**（≈1600px 视口上的 5px）—— 足以让"曲线等于
 *   CSS ease-out"的断言失败，也意味着曲线本身不是 `ease-out` 而是它的近似。
 *   20 次把误差压到 1e-6 量级，与浏览器实现实际一致。
 */
function cubicBezierEaseOut(t: number): number {
  // 控制点 P1=(0,0)（与 P0 重合）、P2=(0.58,1)、P3=(1,1)
  const bezierAxis = (u: number, p1: number, p2: number): number => {
    const i = 1 - u
    return 3 * i * i * u * p1 + 3 * i * u * u * p2 + u * u * u
  }
  // 求 u 使 X(u) = t（X 单调递增，二分收敛）
  let lo = 0
  let hi = 1
  let u = t
  for (let k = 0; k < 20; k++) {
    if (bezierAxis(u, 0, 0.58) < t) lo = u
    else hi = u
    u = (lo + hi) / 2
  }
  return bezierAxis(u, 0, 1)
}

/** 缓动函数（`ease-out`），导出以便测试钉住曲线形状。 */
export function stagePanEase(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0
  if (t >= 1) return 1
  return cubicBezierEaseOut(t)
}

/**
 * 舞台安全区状态（模块级单例 —— 红线 22：使用者必须显式清理）。
 *
 * 由 `MineradioPlayerStage` 在探针尺寸变化时写入**目标值**，
 * `CameraRig` 每帧用 `stepStageSafeArea` 推进缓动、读 `panFraction`。
 * 卸载时 `clearStageSafeArea()`。
 */
export const stageSafeArea = {
  /**
   * 当前**已缓动**的平移比例（正 = 右移）—— 逐帧求值后由 CameraRig 消费。
   * 不要直接写它，用 `stepStageSafeArea(dt)`。
   */
  panFraction: 0,
  /** 目标平移比例（面板开关直接写它，缓动负责逼近） */
  targetPanFraction: 0,
  /** 过渡进度（0..1）。1 = 已到位。 */
  progress: 1,
  /**
   * 本次过渡的起始比例与起始时刻的进度 —— 中途反向（开关快速连点）时
   * 从**当前位置**重新起步，而不是跳回 0 或跳到目标。
   */
  fromPanFraction: 0,
  /** 过渡时长（毫秒）；`prefers-reduced-motion` 时为 `STAGE_PAN_REDUCED_MS` */
  durationMs: STAGE_PAN_DURATION_MS,
}

/**
 * 设置目标平移比例，并（在变化时）重新起步过渡。
 *
 * 与 CSS transition 的语义一致：**目标变化才重启计时**，同值重复调用不动。
 * 中途反向时把当前值记为起点，因此快速开关面板不会让画面跳动。
 */
export function publishStagePanFraction(fraction: number): void {
  const next = Number.isFinite(fraction) ? fraction : 0
  const state = stageSafeArea
  if (next === state.targetPanFraction) return
  state.fromPanFraction = state.panFraction
  state.targetPanFraction = next
  state.progress = state.durationMs <= 0 ? 1 : 0
}

/** 设置过渡时长（`prefers-reduced-motion` → 立即到位）。 */
export function setStagePanDuration(ms: number): void {
  stageSafeArea.durationMs = Number.isFinite(ms) && ms >= 0 ? ms : STAGE_PAN_DURATION_MS
}

/** 平台的减弱动效偏好（无 matchMedia 时视为不需要减弱）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 逐帧推进退让缓动。**必须由每帧唯一的相机写入者调用**（红线：单点驱动）。
 *
 * @param deltaSeconds 本帧时长
 * @returns 当前（缓动后）的平移比例
 */
export function stepStageSafeArea(deltaSeconds: number): number {
  const state = stageSafeArea
  if (state.progress >= 1) {
    state.panFraction = state.targetPanFraction
    return state.panFraction
  }
  const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0
  const step = state.durationMs > 0 ? (dt * 1000) / state.durationMs : 1
  state.progress = Math.min(1, state.progress + step)
  const eased = stagePanEase(state.progress)
  state.panFraction = state.fromPanFraction + (state.targetPanFraction - state.fromPanFraction) * eased
  if (state.progress >= 1) state.panFraction = state.targetPanFraction
  return state.panFraction
}

export function clearStageSafeArea(): void {
  const state = stageSafeArea
  state.panFraction = 0
  state.targetPanFraction = 0
  state.progress = 1
  state.fromPanFraction = 0
  state.durationMs = STAGE_PAN_DURATION_MS
}
