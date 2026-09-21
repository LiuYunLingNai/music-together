/**
 * 渲染策略：画质档、DPR、音频分析量、帧率预算、帧循环模式。
 *
 * ============================ 上游设计（第二十六轮重写） ============================
 *
 * 本模块此前是**自拟**的 `low/medium/high` 三档，且用画质档去门控
 * 粒子网格 / 泛光 / 星河 / 节拍相机 —— 这些在上游 Mineradio 里
 * **都不归画质档**，而是各自独立的设置项：
 *
 *   fx.coverResolution   → 粒子网格（04-fx-defaults.js:14，出厂 1.55 → 183²）
 *   fx.bloom             → 泛光开关（:91，出厂 false）
 *   fx.backgroundStarRiver → 星河（:94，出厂 true）
 *   fx.cinema            → 电影运镜（:91，出厂 true）
 *
 * 上游的 `performanceQuality`（`eco / balanced / high / ultra`，出厂 **eco**）
 * 只控制四件事：
 *
 *   1. **DPR** —— 由 `cap` / `min` / `budget` 三元组推出实际像素比
 *      （`01-scene/00-renderer-quality.js:126-143`）
 *   2. **音频分析量** —— `runtimeAudioAnalysisScale`（0.62~1.0）
 *   3. **音频分析步长** —— `runtimeAnalysisStride`（时域 1/2/3、宽带 1/2/3）
 *   4. **主循环帧率** —— `runtimePerfScale`（0.72/0.84/1.0/1.08）
 *
 * 因此本轮改为**忠实移植这四档**，并把粒子网格/泛光/星河/节拍相机
 * 从画质档解耦（见下方 `lowPower` 说明）。
 */

/** 画质档 —— 与上游 `normalizePerformanceQuality` 的取值域一致。 */
export type VisualQuality = 'eco' | 'balanced' | 'high' | 'ultra'

export const VISUAL_QUALITIES: readonly VisualQuality[] = ['eco', 'balanced', 'high', 'ultra'] as const

export const VISUAL_QUALITY_LABELS: Record<VisualQuality, string> = {
  eco: '节能',
  balanced: '均衡',
  high: '高',
  ultra: '超高',
}

/**
 * 上游 `01-scene/00-renderer-quality.js` 的模块级常量。
 */
const RENDER_DPR_CAP = 1.35
const RENDER_PIXEL_BUDGET = 5_200_000
const RENDER_MIN_DPR = 0.72
/** 上游主循环的活跃帧率基准（`RENDER_ACTIVE_FPS`）。 */
const RENDER_ACTIVE_FPS = 90

/** 硬件画像 —— 上游 `detectRuntimeHardwareProfile`（08-desktop-render-power.js:41-58）。 */
export interface HardwareProfile {
  cores: number
  deviceMemoryGB: number
  devicePixelRatio: number
  cssPixels: number
  renderPixels: number
  lowSpec: boolean
  balancedSpec: boolean
}

export function detectHardwareProfile(): HardwareProfile {
  if (typeof window === 'undefined') {
    return {
      cores: 0,
      deviceMemoryGB: 0,
      devicePixelRatio: 1,
      cssPixels: 1,
      renderPixels: 1,
      lowSpec: false,
      balancedSpec: false,
    }
  }
  const nav = window.navigator as Navigator & { deviceMemory?: number }
  const cores = Number(nav.hardwareConcurrency) || 0
  const memory = Number(nav.deviceMemory) || 0
  const dpr = Number(window.devicePixelRatio) || 1
  const cssPixels = Math.max(1, (Number(window.innerWidth) || 1) * (Number(window.innerHeight) || 1))
  const renderPixels = cssPixels * dpr * dpr
  const lowCore = cores > 0 && cores <= 4
  const lowMemory = memory > 0 && memory <= 4
  const largeSurface = renderPixels >= 4_200_000
  const veryLargeSurface = renderPixels >= 7_200_000
  const lowSpec = lowCore || lowMemory || (cores > 0 && cores <= 6 && veryLargeSurface)
  const balancedSpec = lowSpec || (cores > 0 && cores <= 8) || largeSurface
  return { cores, deviceMemoryGB: memory, devicePixelRatio: dpr, cssPixels, renderPixels, lowSpec, balancedSpec }
}

/** 上游 `renderQualityProfile()`：每档的 DPR 上限 / 下限 / 像素预算。 */
export function renderQualityProfile(
  quality: VisualQuality,
  lowSpec: boolean,
): { cap: number; min: number; budget: number } {
  if (quality === 'eco') return { cap: lowSpec ? 0.88 : 0.95, min: 0.52, budget: lowSpec ? 1_900_000 : 2_400_000 }
  if (quality === 'balanced') {
    return { cap: lowSpec ? 0.98 : 1.12, min: 0.62, budget: lowSpec ? 2_800_000 : 3_800_000 }
  }
  if (quality === 'ultra') return { cap: 1.75, min: 0.85, budget: 7_800_000 }
  return {
    cap: lowSpec ? 1.12 : RENDER_DPR_CAP,
    min: lowSpec ? 0.66 : RENDER_MIN_DPR,
    budget: lowSpec ? 3_600_000 : RENDER_PIXEL_BUDGET,
  }
}

/**
 * 实际渲染像素比 —— 上游 `getRenderPixelRatio()`（00-renderer-quality.js:137-143）：
 *
 *   budgetCap = sqrt(budget / cssPixels)
 *   cap       = min(profile.cap, budgetCap)
 *   ratio     = clamp(min(device, cap), profile.min, +∞)
 *
 * 注意这是**算出来的比值**，不是简单的上限 —— 大屏设备靠 budget 自动降 DPR。
 */
export function getRenderPixelRatio(quality: VisualQuality, profile: HardwareProfile): number {
  const { cap, min, budget } = renderQualityProfile(quality, profile.lowSpec)
  const budgetCap = Math.sqrt(budget / profile.cssPixels)
  const effectiveCap = Math.min(cap, budgetCap)
  return Math.max(min, Math.min(profile.devicePixelRatio, effectiveCap))
}

/** 上游 `performanceQualityRank()`（08-desktop-render-power.js:79-85）。 */
export function performanceQualityRank(quality: VisualQuality): number {
  if (quality === 'eco') return 0
  if (quality === 'balanced') return 1
  if (quality === 'ultra') return 3
  return 2
}

/**
 * 运行时性能预算档 —— 上游 `runtimePerfBudgetLevel()`（:88-95）：
 * 把「用户选的画质档」与「硬件画像」合成一个 0..3 的预算等级。
 */
export function runtimePerfBudgetLevel(quality: VisualQuality, profile: HardwareProfile): number {
  const rank = performanceQualityRank(quality)
  if (rank <= 0) return 0
  if (profile.lowSpec && rank <= 2) return 0
  if (rank <= 1 || (profile.balancedSpec && rank <= 2)) return 1
  if (rank >= 3 && !profile.lowSpec) return 3
  return 2
}

/** 上游 `runtimePerfScale()`（:97-100）：主循环帧率乘数。 */
export function runtimePerfScale(level: number): number {
  return level <= 0 ? 0.72 : level === 1 ? 0.84 : level >= 3 ? 1.08 : 1.0
}

/** 上游 `runtimeAudioAnalysisScale()`（:102-110）：音频分析频率乘数。 */
export function runtimeAudioAnalysisScale(level: number, lowMemory: boolean): number {
  if (level <= 0) return lowMemory ? 0.62 : 0.68
  if (level === 1) return 0.78
  if (level >= 3) return 1.0
  return 0.9
}

/**
 * 上游 `runtimeAnalysisStride()`（:111-127）：频域/时域读取的抽样步长。
 * 步长越大，每帧参与计算的 bin 越少。
 */
export function runtimeAnalysisStride(kind: 'time' | 'wide-band' | 'other', length: number, level: number): number {
  const n = Math.max(1, Number(length) || 1)
  if (kind === 'time') {
    if (level <= 0) return Math.max(2, Math.floor(n / 512))
    if (level === 1) return Math.max(1, Math.floor(n / 768))
    return 1
  }
  if (kind === 'wide-band') {
    if (level <= 0) return 3
    if (level === 1) return 2
    return 1
  }
  return 1
}

export interface RenderPolicy {
  /** 画质档（上游四档） */
  quality: VisualQuality
  /** 运行时性能预算等级（0..3，由画质档 + 硬件画像合成） */
  perfLevel: number
  /** 实际渲染像素比（上游 `getRenderPixelRatio` 的计算结果） */
  pixelRatio: number
  /** 设备像素比上限（R3F Canvas 的 `dpr` 上界用） */
  maxDpr: number
  /** 主循环帧率乘数（上游 `runtimePerfScale`） */
  perfScale: number
  /** 音频分析频率乘数（上游 `runtimeAudioAnalysisScale`） */
  audioAnalysisScale: number
  /** 时域抽样步长（上游 `runtimeAnalysisStride('time', …)`） */
  analysisStrideTime: number
  /** 宽带抽样步长（上游 `runtimeAnalysisStride('wide-band', …)`） */
  analysisStrideWideBand: number
  /** 每帧允许推进的模拟时间上限（秒），防止切回标签页时跳变 */
  maxDeltaSeconds: number

  // ---- 以下**不**由画质档控制（上游是独立设置）----
  /** 粒子网格边长（奇数）—— 来自 `fx.coverResolution` 出厂 1.55 */
  particleGrid: number
  /** 粒子总数 = grid² */
  particleCount: number
  /** 封面粒子分辨率比例，驱动 uCoverRes 的着色器细节档 */
  coverResolutionScale: number
  /** 是否启用泛光叠加（上游 `fx.bloom`，出厂 false —— 见下方说明） */
  bloom: boolean
  /** 是否启用星河流背景层（上游 `fx.backgroundStarRiver`，出厂 true） */
  starRiver: boolean
  /** 是否启用节拍相机（上游 `fx.cinema`，出厂 true） */
  beatCamera: boolean
  /** 是否启用轮廓高亮（上游 `fx.edge`，出厂 false） */
  edgeEnabled: boolean
}

/**
 * 低功耗模式（移动端 / 减少动态效果偏好）。
 *
 * ★ 这是本项目**相对上游的补充**，不是上游机制：上游是桌面应用，
 *   没有触摸设备路径。上游把粒子密度交给 `fx.coverResolution` 独立设置、
 *   画质档只管 DPR；但 Web 端在手机上按 183² 建粒子明显不合适，
 *   因此这里用**独立于画质档**的一个标志来兜底，而不是把它塞回画质档。
 */
export interface PowerContext {
  lowPower: boolean
  /**
   * 用户设置的"粒子溢光"开关（上游 `fx.bloom`，出厂 **false**）。
   *
   * 上游把它作为**独立设置项**（`04-fx-defaults.js:91` + fx 面板的
   * `t-bloom`「粒子溢光」开关），与画质档无关。本项目同样把它做成
   * 设置项（设置 → 外观 → 粒子溢光），默认跟随上游出厂值关闭。
   */
  bloomEnabled: boolean
  /**
   * 用户设置的"轮廓高亮"开关（上游 `fx.edge`，出厂 **false**）。
   *
   * 上游把它作为**独立设置项**（`04-fx-defaults.js:91` + fx 面板的
   * `t-edge`「轮廓高亮」），与画质档无关。着色器用它门控 `edgeBoost`
   * （`00-pointer-cover-particles.js:901`）→ 进 `vBright` 与颜色混合。
   */
  edgeEnabled: boolean
}

export function detectPowerContext(): PowerContext {
  if (typeof window === 'undefined') return { lowPower: false, bloomEnabled: false, edgeEnabled: false }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return { lowPower: reduced || coarse, bloomEnabled: false, edgeEnabled: false }
}

/** 由封面上限推导网格边长（上游 `coverParticleGridForResolution`）。 */
export function particleGridForResolution(resolution: number): number {
  const clamped = Math.max(0.75, Math.min(1.55, resolution))
  let grid = Math.round(118 * clamped)
  grid = Math.max(88, Math.min(183, grid))
  return grid % 2 ? grid : grid + 1
}

/**
 * 上游出厂 `coverResolution`（`00-state/04-fx-defaults.js:14`）。
 * 183² = 33,489 粒子 —— 这是上游的**出厂密度**，与画质档无关。
 */
export const DEFAULT_COVER_RESOLUTION = 1.55
/** 低功耗档的封面分辨率（本项目补充，见 `PowerContext`）。 */
const LOW_POWER_COVER_RESOLUTION = 0.75

export function getRenderPolicy(
  quality: VisualQuality,
  profile: HardwareProfile = detectHardwareProfile(),
  power: PowerContext = detectPowerContext(),
): RenderPolicy {
  const level = runtimePerfBudgetLevel(quality, profile)
  const perfScale = runtimePerfScale(level)
  const coverResolution = power.lowPower ? LOW_POWER_COVER_RESOLUTION : DEFAULT_COVER_RESOLUTION
  const particleGrid = particleGridForResolution(coverResolution)
  return {
    quality,
    perfLevel: level,
    pixelRatio: getRenderPixelRatio(quality, profile),
    maxDpr: getRenderPixelRatio(quality, profile),
    perfScale,
    audioAnalysisScale: runtimeAudioAnalysisScale(level, profile.deviceMemoryGB > 0 && profile.deviceMemoryGB <= 4),
    analysisStrideTime: runtimeAnalysisStride('time', 1024, level),
    analysisStrideWideBand: runtimeAnalysisStride('wide-band', 1024, level),
    // 上游主循环帧率 = RENDER_ACTIVE_FPS × perfScale；delta 上限取其倒数。
    // 旧实现用 1/20~1/60 的固定档，这里对齐上游的实际帧率预算。
    maxDeltaSeconds: 1 / Math.max(30, Math.round(RENDER_ACTIVE_FPS * perfScale)),

    particleGrid,
    particleCount: particleGrid * particleGrid,
    coverResolutionScale: coverResolution,
    // ★ 这三项**不随画质档变**（上游语义：它们是独立设置），全部跟随
    //   上游**出厂值**（`00-state/04-fx-defaults.js:91/94`）：
    //     fx.bloom               = **false**   ← 泛光出厂关闭
    //     fx.backgroundStarRiver = true
    //     fx.cinema              = true
    //   低功耗档（触摸 / 减少动态效果）额外关掉星河与运镜 —— 这是本项目
    //   对 Web 移动端的补充，上游是桌面应用、无此路径（见 `PowerContext`）。
    //
    //   第二十七轮按用户确认「跟随上游」，bloom 从"非低功耗即开启"改为
    //   上游出厂值 false。想开泛光的用户在设置里自行开启。
    // 粒子溢光：跟随用户设置（出厂 false，与上游一致）。
    // 低功耗档强制关闭 —— 第二遍渲染在移动 GPU 上代价最明显。
    bloom: power.bloomEnabled && !power.lowPower,
    starRiver: !power.lowPower,
    beatCamera: !power.lowPower,
    edgeEnabled: power.edgeEnabled,
  }
}

/**
 * `auto` 档的解析结果。
 *
 * ★ 上游出厂就是 `eco`（`00-state/04-fx-defaults.js:187`），本函数以它为准；
 *   但设置里的 `auto` 承诺的是"依据设备能力与减少动态效果偏好选择"
 *   （UI 文案原文），因此这里仍做**保守的设备侧收紧**：
 *
 *     · 低端硬件（`lowSpec`）→ 保持 `eco`
 *     · 其余              → `eco`（上游出厂值）
 *
 *   历史上本项目曾按 `hardwareConcurrency` 给到 medium/high，那是自拟行为；
 *   移植上游后已取消。此函数保留 `detectHardwareProfile()` 的接入点，
 *   以便将来若要"自动"真正分档时有唯一落点，且**不会**再出现
 *   "文档说会自动、实际写死"的错配。
 */
export function detectDefaultQuality(
  profile: HardwareProfile = detectHardwareProfile(),
): VisualQuality {
  // 上游出厂即 eco；低端硬件也只是把预算等级压到 0（见 runtimePerfBudgetLevel），
  // 不改变档位本身。保留 profile 入参以免调用方误以为"与硬件无关"。
  void profile
  return 'eco'
}

/**
 * 帧循环模式：
 * - 页面可见 → always（连续渲染）
 * - 页面不可见（切到别的标签页）→ demand（完全停摆，不空转耗电）
 *
 * 为什么**不能**在"暂停"时用 demand：
 *
 * `demand` 只在 `invalidate()` 被调用时渲染一帧。但本舞台的全部动态
 * 都写在 `useFrame` 里（uniform 推进、涟漪、节拍相机、星河流…），
 * 而这套代码**没有任何地方调用 `invalidate()`**。因此一旦进入 demand：
 *
 *   1. 最多渲染一帧（还是初始化那一帧），之后再也不渲染
 *   2. useFrame 永不执行 → uTime 停在 0 → 粒子静止且极暗
 *   3. 表现为**用户看到一块纯黑画布，直到按下播放才可能亮起来**
 *
 * 这正是"看不出变化/没有粒子"的一层原因：房间没有歌曲时 isPlaying=false，
 * 舞台挂载了、着色器也编译成功了，但画布从头到尾没有被画过。
 *
 * 舞台的粒子/涟漪/封面呼吸都是**持续动画**，暂停时也应继续（视觉上更好，
 * 且是本项目与上游一致的行为），所以这里只看页面可见性。
 * 真正需要省电的场景是后台标签页，那时浏览器本就节流 rAF。
 */
export function resolveFrameloop(_isPlaying: boolean, isDocumentVisible: boolean): 'always' | 'demand' {
  return isDocumentVisible ? 'always' : 'demand'
}
