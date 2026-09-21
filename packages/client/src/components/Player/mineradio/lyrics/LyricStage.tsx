import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  buildStageLines,
  computeLineProgress,
  findActiveLineIndex,
  hasWordTiming,
  type StageLine,
} from './stageLyricModel'
import {
  LYRIC_FONT_SIZE,
  LYRIC_MASK_BASE_WIDTH,
  glowColorForPalette,
  rasterizeLineGlowMask,
  rasterizeLineReadabilityMask,
  rasterizeLyricLineMask,
  type LyricLineRaster,
} from './rasterizeLyricMask'
import { LYRIC_FRAGMENT_SHADER, LYRIC_VERTEX_SHADER } from './lyricShaders'
import {
  getContextStyle,
  getMotionProfile,
  lyricLineCountForMode,
  lyricSlotOffsets,
  retractTranslationMode,
  type LyricContextStyle,
  type LyricDisplayMode,
  type LyricMotionStyle,
  type LyricTranslationMode,
} from './lyricDisplayConfig'
import { DEFAULT_PALETTE, type CoverPalette } from './coverPalette'
import { readAudioBands } from '../shared/AudioAnalyser'
import { detectHardwareProfile } from '../shared/RenderPolicy'
import { coverPose, lyricWorldPos } from '../particles/gestureRotationState'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLyricOffsetKey } from '@/lib/lyricOffset'

/** 世界尺寸，参照 Mineradio 的 worldW（上游 6.10） */
const WORLD_W = 6.1

/**
 * 歌词平面的世界 Z 位置（Mineradio 原值 1.46）。
 */
const LYRIC_PLANE_Z = 1.46

/**
 * 上下文行的基准透明度（上游 cinema 上下文 ≈0.54，经 depthFade 衰减后更低）。
 */
const CONTEXT_OPACITY = 0.54

/**
 * 上下文行透明度随行距的衰减（上游 12-lyrics-row-layers.js:1465）：
 *   contextAlpha = targetAlpha * (1 - max(0, targetAbs - 0.25) * 0.070)，夹 [0.16, 0.92]
 */
const CONTEXT_ALPHA_FALLOFF = 0.07
const CONTEXT_ALPHA_MIN = 0.16

/**
 * 行深度公式（上游 lyricRowDepthZ / zBase，12-lyrics-row-layers.js:122-126,1605）：
 *   z = 0.055 - |Δ|^1.06 * 0.145，|Δ| 夹 5.5
 * 越远的行越沉向舞台深处 —— 这就是上游歌词的"立体纵深"。
 */
const ROW_Z_BASE = 0.055
const ROW_Z_POW = 1.06
const ROW_Z_GAIN = 0.145
const ROW_MAX_DELTA = 5.5

/**
 * 行缩放公式（上游 12-lyrics-row-layers.js:1610）：
 *   scale = clamp(1 - |Δ| * 0.026, 0.84, 1.02)
 */
const ROW_SCALE_FALLOFF = 0.026
const ROW_SCALE_MIN = 0.84

/**
 * 逐字填充的边缘羽化宽度（上游 `11-lyrics-shaders.js:78`）：
 *   uFeather = lyricsHasNativeKaraoke ? 0.030 : 0.055
 *
 * ★ 这个 uniform 同时决定**填充边界软硬**（`filled` 的 smoothstep 宽度）与
 *   **扫光边缘带**（`edge` 的 `uFeather * 2.8`）。
 *
 *   此前本项目用 `min(0.08, 22 / raster.width)` —— 画布 2048 时约 0.0107，
 *   比上游硬 3~5 倍，逐字边界像刀切、边缘高亮几乎看不见。
 *   上游的取值与画布宽度**无关**（它是 UV 空间的固定宽度），
 *   只按"是否有逐字时间轴"分两档 —— 有逐字时边界更锐利（0.030），
 *   整行平滑推进时更柔（0.055）。
 *
 *   上游按行（`lyricsHasNativeKaraoke(line)`）判定；本项目在 `stepRow`
 *   里按该行是否有逐字数据取档，因此导出为一个取值函数。
 */
export const LYRIC_FEATHER_NATIVE_KARAOKE = 0.03
export const LYRIC_FEATHER_SMOOTH = 0.055

/**
 * 逐字进度缓动（上游 `14-stage-lyrics-rendering.js:2297-2310`）。
 *
 *   有逐字时间轴 → 直接取目标值（精确贴合音频）
 *   无逐字       → shownProgress 逐帧追赶目标：
 *     diff = target - shown
 *     ease = |diff| > 0.42 ? max(0.52, progressEase × 1.55) : progressEase
 *     age < 0.16s 时 ease = max(ease, 0.28)（入场快速跟上）
 *     shown = clamp(shown + diff × ease, 0, 1)
 *
 * `progressEase` 来自运动风格（上游 lyricMotionProfile.progressEase）：
 * 基准 = 无逐字 0.18，乘风格系数后
 * `clamp(base / clamp(softness, 0.35, 1.2), 0.08, 0.72)`
 * （softness 出厂 0.72，04-fx-defaults.js:47）。
 *
 * 此前本项目把 computeLineProgress 的结果**直接**写进 uProgress ——
 * 无逐字歌词的填充按帧跳变，上游是平滑追上；入场也没有加速。
 */
const MOTION_SOFTNESS = 0.72
const PROGRESS_EASE_BASE = 0.18
const MOTION_PROGRESS_FACTOR: Record<LyricMotionStyle, number> = {
  float: 0.66,
  smooth: 0.72,
  glass: 0.9,
  quick: 1.34,
  shine: 1.02,
  glitch: 1.24,
}
/** 上游 :169 的收尾夹取。 */
function progressEaseFor(style: LyricMotionStyle): number {
  const base = PROGRESS_EASE_BASE * (MOTION_PROGRESS_FACTOR[style] ?? 1)
  const soft = Math.max(0.35, Math.min(1.2, MOTION_SOFTNESS))
  return Math.max(0.08, Math.min(0.72, base / soft))
}
/** 大跨度追赶（上游 :2305）。 */
const PROGRESS_BIG_JUMP = 0.42
const PROGRESS_BIG_JUMP_MIN = 0.52
const PROGRESS_BIG_JUMP_MUL = 1.55
/** 入场加速（上游 :2306）。 */
const PROGRESS_AGE_WINDOW = 0.16
const PROGRESS_AGE_MIN_EASE = 0.28

/**
 * 滚动轨道的两段缓动（上游 baseTrackEase / trackEase，:1372-1373）：
 * 行切换时轨道以 `ease * 1.16` 缓动（夹 [0.08, 0.34]），并做与帧率无关
 * 的换算 `1 - (1-ease)^(dt*60)`。
 */
const TRACK_EASE = 0.16 * 1.16
const TRACK_MAX_ROWS_PER_FRAME = 0.68

/**
 * 揭示编排（上游 :1526-1528）：行进入渲染窗口后延迟
 * `10 + lane*14` ms 才显现（lane = 距离取整），形成从近到远的交错揭示。
 */
const REVEAL_BASE_MS = 10

/**
 * renderOrder 基准：上游逐行是 42.x/43.4（上游卡片只有 50-60，所以压得住）。
 * 本项目卡片中心卡是 300，此前整块歌词用 310 压卡片 —— 逐行版整体 +258
 * 平移到同一区间，行间相对关系与上游完全一致：
 * 激活行 301.4，上下文行 300.6−|Δ|×0.015，可读性层再 −0.05。
 */
const RENDER_ORDER_OFFSET = 258
const REVEAL_LANE_MS = 14

/**
 * 译词独立行（上游 08-lyrics-display-modes.js 的虚拟槽位 + 14-...js 的
 * translationLine 条目 —— 译词是**独立网格**，绝不与主行同纹理）：
 *
 *   - 有译词的行（或其前一行有）占用更多主行槽位（见 `SLOT_WITH_TRANS`）
 *   - 译词行挂在父行 +`TRANS_GAP` 槽位处
 *   - 滚动轨道以虚拟槽位为单位推进，主行与译词行各占各的槽 ——
 *     重叠在结构上不可能发生（此前译词画进主行纹理，行距不随纹理
 *     变高而展开，相邻行直接叠字）
 *
 * ★ 第二十五轮：间距基准从"上游槽位出厂值"改为"按主字号推导的 AMLL 比值"
 *   （`TRANS_GAP_WORLD` / `TRANS_GAP`），详见下方常量说明。
 */
const SLOT_PLAIN = 1.0
/**
 * 槽位 → 世界坐标的步长（world per slot）。主行与译词行的 `yTarget`
 * 都用它换算（`-delta * LYRIC_LINE_STEP_WORLD`）。
 *
 * 提取为具名常量：此前这个 0.38 在两处硬编码，而译词间距要按"主字号"
 * 推导（见下），必须有一个单一来源。
 */
const LYRIC_LINE_STEP_WORLD = 0.38

/** 1 栅格 px 对应的世界长度（遮罩画布 2048 基宽映射到 WORLD_W）。 */
const WORLD_PER_RASTER_PX = WORLD_W / LYRIC_MASK_BASE_WIDTH
/** 主行字号的世界尺寸（栅格字号 128px）。 */
const MAIN_FONT_WORLD = LYRIC_FONT_SIZE * WORLD_PER_RASTER_PX
/** 译词字号相对主行的比例（栅格 scale，与 rasterizeLyricLineMask 的 0.52 同源）。 */
const TRANS_FONT_SCALE = 0.52

/**
 * 两行文字**不相重叠**所需的最小中心距。
 *
 * 两行各自以自身中心为基准绘制，因此「字形边缘间距 = 中心距 − (上行字高 + 下行字高)/2」。
 * 中心距一旦小于这个和，两行的字形就真的叠上了 —— 这是间距的**硬下界**。
 */
function glyphTouchDistance(upperFontWorld: number, lowerFontWorld: number): number {
  return (upperFontWorld + lowerFontWorld) / 2
}

/**
 * 主歌词 → 译词的槽位偏移。
 *
 * ============================ 为什么不是"照搬 AMLL 的 0.3em" ============================
 *
 * ★ 第二十五轮曾把 AMLL 的 `gap: 0.3em` 直接当成中心距使用 —— 这是**量纲错误**，
 *   导致译词与主歌词**重叠**（实测字形边缘间距 −0.46em，即叠进去近半个字高）。
 *
 *   AMLL 的 `0.3em` 是 flex 容器的 **box 到 box 空白**：它作用在两个
 *   `line-height` 盒子之间（主行盒 1.2em、副行盒 1.5em），换算成中心距是
 *   `0.6 + 0.3 + 0.375 = 1.275em`；而本项目这里需要的是**中心距**。
 *   两者不是同一个量，不能直接搬。
 *
 * ★ 真正的约束是"译词必须和**它的**主歌词成组、和**下一句**分开"：
 *
 *     主歌词 ──(a)── 译词 ──(b)── 下一句主歌词
 *
 *   原始上游分布 a=1.2104 / b=0.9110 槽位，换算成**字形边缘间距**是
 *   a=+0.446em、b=+0.148em —— 译词离自己的主歌词远、离下一句近，
 *   眼睛会把译词**归到下一句**去，这正是"间距有点大"的真实观感来源。
 *
 * ★ 因此这里取 `a = b`（把整段间距**均分**到译词两侧），而不是照搬某个绝对值：
 *   既满足"译词紧贴自己的主歌词"，又保住"与下一句有明确分隔"，
 *   且**总高度完全不变**（a+b 仍是上游的 2.1214 槽位）——
 *   主歌词之间的整体节奏、可见半径、槽位布局全部不受影响。
 *
 *   均分后字形边缘间距：上方 +0.297em、下方 +0.297em（完全对称、无重叠）。
 */
const TRANS_GAP = 2.1214 / 2
/** 译词行的字形高度（世界单位），供间距校验与测试使用。 */
export const TRANS_GLYPH_TOUCH_WORLD = glyphTouchDistance(
  MAIN_FONT_WORLD,
  MAIN_FONT_WORLD * TRANS_FONT_SCALE,
)
/** 译词与主歌词之间的实际字形边缘间距（世界单位；负值 = 重叠）。 */
export const TRANS_GLYPH_GAP_WORLD = TRANS_GAP * LYRIC_LINE_STEP_WORLD - TRANS_GLYPH_TOUCH_WORLD

/**
 * 有译词行的主行槽位步长 —— 保持上游出厂总量不变。
 *
 * `TRANS_GAP + (2.1214 − 1.2104)` 的写法已废弃：它把"主→译词"与
 * "译词→下一句"当成两段独立的量，但真正要调的是**这两段的比例**。
 * 现在 `TRANS_GAP = 总量/2`，两侧自动相等，总量恒为 2.1214。
 */
const SLOT_WITH_TRANS = 2.1214
/** 当前译词行透明度基准（上游 14-stage-lyrics-rendering.js:2695：clamp(0.86+0.08, 0.48, 1) = 0.94）。 */
const TRANS_CURRENT_ALPHA = 0.94
/**
 * 上下文译词透明度基准（上游 14-stage-lyrics-rendering.js:2697 的
 * `clamp(baseAlpha × 0.62, 0.24, 0.60)`，baseAlpha 取 0.58 → 0.3596 ≈ 0.36；
 * 本项目沿用既有 0.33，仅作为 multi 模式的上下文混合起点）。
 */
const TRANS_CONTEXT_ALPHA = 0.33
/** 译词透明度下界（上游 :1477/:1490 的 clamp 下界 0.08）。 */
const TRANS_ALPHA_MIN = 0.08
/** 父行淡出窗（上游 :1479：(0.82 − parentDistance)/0.34 smoothstep）。 */
const TRANS_PARENT_FADE = 0.34
/** 译词字重（上游 translation 条目 weight 650）。 */
const TRANS_FONT_WEIGHT = 650
/**
 * 译词行的建行窗口（按**父行到激活行的行距**计）。
 *
 * ★ 必须与效果层裁剪窗口同源，否则会出现"建了立刻被裁、下一帧又重建"的
 *   逐帧抖动（详见 stepRow 调用处的说明）。取 `READABILITY_KEEP_AFTER`
 *   同一量级：窗口内建、窗口外不建，两者对齐即无抖动。
 */
const TRANS_KEEP_BEFORE = 6
const TRANS_KEEP_AFTER = 24

/**
 * 常驻轨道的懒建策略（上游 `trackPersistent`，14-stage-lyrics-rendering.js）：
 *
 * 上游把整首歌的文本行全部常驻（trackStart=0 / trackEnd=length-1），
 * 效果层（可读性/辉光）按需补建、窗口外裁剪（trimStageLyricPersistentTrackRows：
 * keepStart = target−6，keepEnd = target+24）。本项目对齐这一结构，但文本行
 * 也走"接近窗口才建"的懒建 —— 稳态播放下每换一行只栅格化 1~2 个新行，
 * 观感与全量常驻一致（换行 = 0 次重栅格化），而显存按已播放行数渐进增长。
 */
/** 初始构建半径：进入舞台时一次性建好激活行 ±N 行，保证首屏完整。 */
const INITIAL_BUILD_RADIUS = 7
/** 预建余量：窗口外再多建 N 行，让揭示动画期间新行已就绪。 */
const PREBUILD_MARGIN = 2
/** 可读性层保留窗口（上游 trimStageLyricPersistentTrackRows 的 6/24）。 */
const READABILITY_KEEP_BEFORE = 6
const READABILITY_KEEP_AFTER = 24

/**
 * 逐行视口适配（上游 lyricViewportSafeMarginPx / lyricViewportFitRatio，
 * :239-260）：行文字投影后左右留白不足 4.5% 视口宽（夹 [42,92]px）时收缩，
 * 收缩下限 0.22。这是上游"长短句都和谐"的真机制 —— 每行独立适配，
 * 短行保持原大、长行收进视口。
 */

/**
 * 歌词避让侧栏的偏移链（上游 `shelfLyricAvoid` 分支）：缩放 ×0.72、
 * x −1.36、y +0.06、z +0.72。本项目 3D 歌单架常驻挂载，歌词恒定应用。
 */
const SHELF_AVOID_SCALE = 0.72
const SHELF_AVOID_X = 1.36
const SHELF_AVOID_Y = 0.06
const SHELF_AVOID_Z = 0.72

/**
 * 声波地形的歌词抬升（实机反馈：地形模式歌词偏低）。
 * 地形模式不挂 ParticleField，`coverPose.active` 恒 false，歌词走固定姿态
 * 分支 —— 该分支实际只服务地形。
 */
const TOPOGRAPHY_LIFT_Y = 0.35

/**
 * 辉光层（上游 12-lyrics-row-layers.js makeLyricRowGlowMesh +
 * 14-stage-lyrics-rendering.js 的 rowGlow/beatGlow/highBloom 链）：
 *
 * 出厂参数：lyricGlowStrength 0.28 → glowDrive = min(1.7, 0.28/0.50) = 0.56；
 * 辉光强度 currentLineGlow = min(1.05, (0.10 + solar×0.40 + beatGlow×0.24 +
 * beatPulse×0.08) × min(2.4, 0.56) × glowLift)。透明度渐变升 0.20 / 降 0.34。
 */
const GLOW_STRENGTH = 0.28
const GLOW_DRIVE = Math.min(1.7, GLOW_STRENGTH / 0.5)
/** 透明度渐变系数（上游 :1724）。 */
const GLOW_RISE = 0.2
const GLOW_FALL = 0.34
const GLOW_ZERO = 0.004

/** glowLift 按运动风格（上游 lyricMotionProfile 的 profile.glowLift）。 */
const GLOW_LIFT: Record<LyricMotionStyle, number> = {
  float: 1.16,
  smooth: 0.74,
  glass: 1.0,
  quick: 0.86,
  shine: 1.3,
  glitch: 1.08 + 1.0 * 0.1,
}

/**
 * 亮底避光（上游 lyricBackgroundAdapt，出厂 0.72，12-lyrics-row-layers.js:185-206）：
 *
 * 封面粒子/环境底较亮时（Emily 亮封面等），加深可读性描边并提升其权重：
 *   - 描边颜色向近黑 lerp（strength×0.92，cap 0.92）—— 上游 lyricReadabilityColorForBrightBackdrop
 *   - readabilityMix 提升为 max(mix, 0.60 + strength×0.12)
 *   - 描边整体透明度 ×(1 + strength×0.78)
 * 这是上游"亮背景下歌词依然清晰"的核心机制。
 */
const BACKDROP_ADAPT = 0.72
const READABILITY_DARK = '#04070c'
/** 缓存的近黑描边颜色（上游 lyricReadabilityDarkColor 单例）。 */
const readabilityDarkColor = new THREE.Color(READABILITY_DARK)

interface LyricStageProps {
  /** 从封面提取的完整调色板 */
  palette?: CoverPalette | null
  /** 显示模式 */
  displayMode?: LyricDisplayMode
  /** 自定义行数（displayMode = custom 时生效） */
  customLineCount?: number
  /** 运动风格 */
  motionStyle?: LyricMotionStyle
  /** 译词模式 */
  translationMode?: LyricTranslationMode
}

/**
 * ★ 已删除：`onLineRects` / `LineHitRect`（歌词行屏幕命中区域）。
 *
 * 上游 Mineradio **没有**"点击歌词跳转"功能 —— 全仓唯一的画布 click 监听
 * 属于歌单架（`04-shelf/05-card-interactions.js:70`），`02-visual/1*.js`
 * 里 grep `seek`/`click` 全部零命中。
 *
 * 本项目此前为它做了隔帧四角投影（每 2 帧对每行做一次矩阵乘 + 投影），
 * 而这个入口在视觉舞台下必然误触发：画布同时承载"拖拽转物体"手势，
 * 拖动途中只要按下点落在某行歌词的投影矩形内，松手就跳转。
 *
 * 按"对齐上游"删除整条链路（含逐帧投影开销）。经典播放器的歌词点击跳转
 * 走的是 AMLL 的 `onLyricLineClick`（`LyricDisplay.tsx`），与本文件无关，
 * 不受影响。
 */

/**
 * 单行的三层网格 + 状态（上游 `row` 对象的等价物）。
 *
 * 主行与可读性层是独立网格（上游同构：readability 在文字后 0.012、
 * renderOrder −0.04~−0.05）；辉光层（row.glow）依赖上游独立的辉光纹理
 * 生成器，暂不移植（见 HANDOFF 记录）。
 */
interface LyricRow {
  /** 对应的舞台行（全局索引 = stageLines 下标） */
  lineIndex: number
  line: StageLine
  /** 行遮罩（单行栅格化） */
  raster: LyricLineRaster
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  texture: THREE.CanvasTexture
  readability: THREE.Mesh | null
  readabilityMaterial: THREE.MeshBasicMaterial | null
  readabilityTexture: THREE.CanvasTexture | null
  /** 辉光层（上游 row.glow / row.glowMat，AdditiveBlending，z −0.030） */
  glow: THREE.Mesh | null
  glowMaterial: THREE.MeshBasicMaterial | null
  glowTexture: THREE.CanvasTexture | null
  /** 目标透明度（激活行 1，上下文行按 alpha 链；上游 entry.alpha 语义） */
  targetAlpha: number
  /**
   * 该行栅格化时是否按激活规格（scale=1 / alpha=1）。
   * 上游 makeLyricLineMask(entry, mask, asActive) 对"成为当前行"的行按
   * active 规格重建；懒建的行最初是上下文规格，首次激活时必须重建 ——
   * 否则它激活后仍带着上下文的淡纹理与低目标透明度，高亮明显偏暗。
   */
  builtAsActive: boolean
  /** 揭示时刻（ms 时间戳；0 = 未进入窗口） */
  revealAt: number
  /** 是否已在窗口内（控制揭示编排） */
  windowActive: boolean
  /**
   * 该行已存在的时长（秒）—— 上游 `mesh.userData.age`。
   * 供逐字进度的入场加速使用（上游 :2306：age < 0.16 时 ease 至少 0.28）。
   */
  age: number
  /** 译词独立行（上游 translationLine: true —— 独立网格/纹理/虚拟槽位） */
  isTranslation?: boolean
  /** 译词行的父主行索引 */
  parentIndex?: number
}

/**
 * 逐行视口适配（上游 lyricRowLiveViewportScale + lyricViewportFitRatio）：
 * 把行文字左右两端投影到屏幕，若投影宽度超过视口可用宽（两侧各留
 * max(4.5% 视口宽, 42~92px) 边距）则按比例收缩，下限 0.22。
 * 行居中于其世界位置 —— 用左右空间较小的一侧作限制。
 */
function lyricRowFitRatio(
  mesh: THREE.Mesh,
  raster: LyricLineRaster,
  viewportWidth: number,
  camera: THREE.Camera,
): number {
  if (viewportWidth <= 1) return 1
  const marginPx = Math.min(viewportWidth * 0.25, Math.max(42, Math.min(92, viewportWidth * 0.045)))
  const textRatio = Math.min(1, raster.textWidth / Math.max(1, raster.width))
  const planeWidth = (mesh.geometry as THREE.PlaneGeometry).parameters.width
  const localTextWidth = planeWidth * textRatio
  if (localTextWidth <= 0.001) return 1

  mesh.updateWorldMatrix(true, false)
  const left = new THREE.Vector3(-localTextWidth * 0.5, 0, 0).applyMatrix4(mesh.matrixWorld).project(camera)
  const right = new THREE.Vector3(localTextWidth * 0.5, 0, 0).applyMatrix4(mesh.matrixWorld).project(camera)
  if (!Number.isFinite(left.x) || !Number.isFinite(right.x)) return 1

  const leftPx = (left.x + 1) * viewportWidth * 0.5
  const rightPx = (right.x + 1) * viewportWidth * 0.5
  const centerX = (leftPx + rightPx) * 0.5
  const currentWidth = Math.abs(rightPx - leftPx)
  const unitWidth = currentWidth / Math.max(0.001, mesh.scale.x)
  const intendedWidth = unitWidth * mesh.scale.x

  const leftSpace = Math.max(0, centerX - marginPx)
  const rightSpace = Math.max(0, viewportWidth - marginPx - centerX)
  const availableWidth = Math.max(1, Math.min(leftSpace, rightSpace) * 2)
  if (intendedWidth <= availableWidth) return 1
  return Math.max(0.22, Math.min(1, availableWidth / intendedWidth))
}

/** 上下文行的缩放：越远越小（参照 Mineradio 的 near/far scale）。 */
/**
 * 把「槽位空间的行差」换算成「行偏移」。
 *
 * 槽位被译词展开后（SLOT_WITH_TRANS ≈ 2.1214），相邻主行的槽位差不是 1
 * 而是 2.1214，不能直接拿去和上游的整数偏移集比较。上游自身用的是
 * **行索引**差（`row.lineIndex - presentationLineIndex`），因此这里也按
 * 行索引差取整 —— 调用方传的就是 `lineIndex - active`，取整即得行偏移。
 */
function roundToLineOffset(delta: number): number {
  return Math.round(delta)
}

function contextScaleFor(distance: number, style: LyricContextStyle): number {
  if (distance === 0) return 1
  return distance === 1 ? style.nearScale : style.farScale
}

/**
 * 该行的 uFeather 取值（上游 `11-lyrics-shaders.js:78`）：
 *   lyricsHasNativeKaraoke(line) ? 0.030 : 0.055
 *
 * 上游的判定就是"这行是否有逐字时间轴"（`lyricLineHasNativeKaraoke`：
 * words 非空且 charCount > 0），本项目用 `hasWordTiming` 表达同一语义
 * （它额外排除了"整行退化成一个 word / 所有 word 共享同一区间"的伪逐字，
 * 那种情况本就该走整行平滑推进的柔和边界）。
 */
function lyricFeatherFor(line: StageLine): number {
  return hasWordTiming(line.words) ? LYRIC_FEATHER_NATIVE_KARAOKE : LYRIC_FEATHER_SMOOTH
}

/**
 * 按逐字 obscene 标记替换敏感词（保持字符数不变，区间不错位）。
 */
function maskObsceneLine(line: StageLine, maskChar: string): string {
  const char = maskChar || '*'
  return line.words
    .map((word) => (word.obscene ? Array.from(word.text).map(() => char).join('') : word.text))
    .join('')
}

/**
 * 译词/音译的展示策略 —— 返回该行的附属行列表（独立行，见虚拟槽位说明）。
 */
function translationSubEntries(line: StageLine, mode: LyricTranslationMode): string[] {
  if (mode === 'off') return []
  const out: string[] = []
  if (line.translation) out.push(line.translation)
  if (mode !== 'current' && line.roman) out.push(line.roman)
  return out
}

/**
 * LRC 兜底：当没有逐字数据时，把纯文本歌词转成 AMLL 结构。
 * 与 `LyricDisplay` 的 LRC 路径保持同样的时间口径。
 */
function lrcToAmllLines(lyric: string, tlyric: string) {
  const parse = (text: string) => {
    const out: Array<{ time: number; text: string }> = []
    const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      const minutes = parseInt(m[1], 10)
      const seconds = parseInt(m[2], 10)
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0
      const value = m[4].trim()
      if (value) out.push({ time: minutes * 60 + seconds + ms / 1000, text: value })
    }
    return out.sort((a, b) => a.time - b.time)
  }

  const originals = parse(lyric)
  if (originals.length === 0) return []

  const translations = new Map<number, string>()
  for (const t of parse(tlyric)) {
    translations.set(Math.round(t.time * 10) / 10, t.text)
  }

  return originals.map((line, i, arr) => {
    const startMs = Math.round(line.time * 1000)
    const endMs = Math.round((arr[i + 1]?.time ?? line.time + 5) * 1000)
    return {
      words: [
        { word: line.text, startTime: startMs, endTime: endMs, romanWord: '', obscene: false },
      ],
      translatedLyric: translations.get(Math.round(line.time * 10) / 10) ?? '',
      romanLyric: '',
      startTime: startMs,
      endTime: endMs,
      isBG: false,
      isDuet: false,
    }
  })
}

/**
 * WebGL 歌词舞台 —— 常驻轨道 + 逐行分层（上游 `12-lyrics-row-layers.js` +
 * `14-stage-lyrics-rendering.js` 的 trackPersistent 结构）。
 *
 * 每行是**独立**的遮罩纹理 + 网格 + 可读性描边平面，挂在共享的滚动轨道上：
 *
 *   - 常驻轨道（trackPersistent）：行槽位覆盖**整首歌**；行按"接近窗口才建"
 *     的懒建策略补齐（稳态播放每换一行只栅格化 1~2 个新行），已建的行不再
 *     重栅格化 —— 换行 = 0 次重栅格化，与上游全量常驻的滚动观感一致
 *   - 滚动轨道（trackScrollOffset）：行切换时轨道缓动到新激活行，
 *     每帧步长不超过 0.68 行（上游 continuousTrackMaxRowsPerFrame ——
 *     "no rendered frame may skip across a complete primary lyric row"）
 *   - 行深度：z = 0.055 − |Δ|^1.06×0.145，远的行沉入舞台深处
 *   - 行缩放：1 − |Δ|×0.026；行透明度按 alpha 链衰减 + 距离淡出
 *   - 交错揭示：行进入窗口后 10+lane×14ms 才显现
 *   - 逐行视口适配：投影行文字两端，超宽时收缩（上游 lyricRowLiveViewportScale）
 *   - 效果层裁剪：窗口外（激活行 −6/+24 之外）的可读性层释放（上游 trim 语义）
 *
 * ★ 激活态逐帧重判（上游 isActive = rowLineIndex === presentationLineIndex）：
 * 行的栅格化字号/目标透明度在构建时确定（上游 entry.scale / entry.alpha 同为
 * 构建时值），但"哪一行是激活行"、逐字进度、节拍泛光全部逐帧计算 ——
 * 此前把激活窗口冻结在构建时刻，导致"激活行高亮永远不消失"。
 *
 * 每行独立 uniform（uProgress/uActiveMix）—— 为 AMLL 逐字动画铺路：
 * 后续逐字进度只需要把 uProgress 从行级标量升级为逐字数据，架构不动。
 */
export function LyricStage({
  palette,
  displayMode = 'cinema',
  customLineCount = 5,
  motionStyle = 'float',
  translationMode = 'multi',
}: LyricStageProps) {
  const ttmlLines = usePlayerStore((s) => s.ttmlLines)
  const lyric = usePlayerStore((s) => s.lyric)
  const tlyric = usePlayerStore((s) => s.tlyric)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const lyricOffsets = useSettingsStore((s) => s.lyricOffsets)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const maskObsceneChar = useSettingsStore((s) => s.lyricMaskObsceneWordChar)
  const maskMode = useSettingsStore((s) => s.lyricMaskObsceneWordsMode)

  // 显示模式决定轨道可见半径
  const stackLines = lyricLineCountForMode(displayMode, customLineCount)
  /**
   * 译词档位：先按显示行数做**自适应收缩**（用户选的档位只会被下调）。
   *
   * ★ 下游一律使用这个 `effectiveTranslationMode`，不再直接用 prop ——
   *   否则槽位布局、可见半径、建行窗口会与实际渲染的译词行不一致
   *   （收缩后仍按原档算槽位 = 行距错乱）。
   */
  const effectiveTranslationMode = retractTranslationMode(translationMode, stackLines)
  const contextStyle = getContextStyle(displayMode, CONTEXT_OPACITY)
  const motion = getMotionProfile(motionStyle)
  const colors = palette ?? DEFAULT_PALETTE

  // 时间偏移校准：沿用与 AMLL 相同的口径
  const offsetKey = getLyricOffsetKey(currentTrack)
  const offsetMs = lyricOffsets[offsetKey ?? ''] ?? 0
  const nowSeconds = Math.max(0, currentTime - offsetMs / 1000)

  // 逐字数据优先；没有 ttmlLines 时用 LRC 文本兜底
  const stageLines = useMemo<StageLine[]>(() => {
    if (ttmlLines && ttmlLines.length > 0) return buildStageLines(ttmlLines)
    const fallback = lrcToAmllLines(lyric, tlyric)
    return buildStageLines(fallback)
  }, [ttmlLines, lyric, tlyric])

  const activeIndex = useMemo(() => findActiveLineIndex(stageLines, nowSeconds), [stageLines, nowSeconds])

  /**
   * 虚拟槽位（上游 lyricPrimaryVirtualIndex / lyricTranslationVirtualIndex）：
   * 主行 i 的槽位起点按"本行或前一行有无译词"展开（1.9 或 1.0）；
   * 译词行 k 的槽位 = 父行起点 + TRANS_GAP + k×translationLineStepWorld
   * （上游 12-lyrics-row-layers.js:42-48：worldH×lineHeight/maskH ×1.04，
   * 夹 [0.20,0.78]；本项目取典型 0.5 档 —— 多附属行极少见，仅音译+译词
   * 同开时才出现第二行）。
   * 滚动轨道、行距、可见半径全部以槽位为单位 —— 有译词的行自动多占空间，
   * 重叠在结构上不可能发生。
   */
  const slotInfo = useMemo(() => {
    const slotStart: number[] = new Array(stageLines.length + 1)
    const transSlot: Array<number[] | null> = new Array(stageLines.length)
    /** 前缀偏移：第 i 行之前累计的译词行数（译词行在 rows 数组的后半区） */
    const transOffset: number[] = new Array(stageLines.length + 1)
    let s = 0
    let t0 = 0
    for (let i = 0; i < stageLines.length; i++) {
      slotStart[i] = s
      transOffset[i] = t0
      const subs = translationSubEntries(stageLines[i], effectiveTranslationMode)
      if (subs.length > 0) transSlot[i] = subs.map((_, k) => s + TRANS_GAP + k * 0.5)
      else transSlot[i] = null
      const prevHas = i > 0 && translationSubEntries(stageLines[i - 1], effectiveTranslationMode).length > 0
      s += subs.length > 0 || prevHas ? SLOT_WITH_TRANS : SLOT_PLAIN
      t0 += subs.length
    }
    slotStart[stageLines.length] = s
    transOffset[stageLines.length] = t0
    return { slotStart, transSlot, transOffset }
  }, [stageLines, effectiveTranslationMode])

  // 遮罩字符：仅在启用遮罩模式时替换
  const obsceneChar = maskMode ? maskObsceneChar || '*' : ''

  const groupRef = useRef<THREE.Group>(null)
  /** 复用的四元数缓冲 */
  const coverQuat = useMemo(() => new THREE.Quaternion(), [])
  /**
   * 常驻轨道的行槽位：前半 = 主行（长度 = 整首歌行数），后半 = 译词独立行
   * （每主行最多 2 条：译词 + 音译）。未建的槽位为 null。
   * 行按"接近窗口才建"的懒建策略逐个补齐，建出的行永不重栅格化。
   */
  const rowsRef = useRef<(LyricRow | null)[]>([])
  /** 栅格化失败的行（无 2D 上下文等），不再重试避免每帧风暴 */
  const failedRowsRef = useRef<Set<number>>(new Set())
  /**
   * 滚动轨道（上游 data.trackScrollOffset）：连续值，行切换时缓动过去。
   * 保存在 ref 里跨帧延续 —— 行窗口以它为中心取，而不是激活行的整数索引。
   */
  const trackScrollRef = useRef(0)
  /**
   * 辉光链的逐帧状态（上游 stageLyrics.beatGlow / highBloom / glowBreath）：
   * sunEnergy 是副歌/高音段落的持续能量检测（上游 lyricSun*，主循环 :502-520）。
   */
  const glowStateRef = useRef({ beatGlow: 0, highBloom: 0, sunAvg: 0, sunPeak: 0.55, sunHold: 0, sunEnergy: 0 })
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const motionRef = useRef(motion)
  motionRef.current = motion

  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy?.()) ?? 1
  /**
   * 各向异性预算 —— 上游 `configureLyricTextureSampling`
   * （`10-lyrics-mask-textures.js:31-32`）按**硬件画像**分档：
   *   lowSpec → 4 / balancedSpec → 8 / 其余 → 16，最后与设备上限取小。
   *
   * 此前本项目硬编码 8，等于把低端设备抬到中档、高端设备压到中档 ——
   * 两个方向都偏离上游。
   */
  const hardware = useMemo(() => detectHardwareProfile(), [])
  const anisotropyBudget = hardware.lowSpec ? 4 : hardware.balancedSpec ? 8 : 16
  const lyricAnisotropy = Math.min(anisotropyBudget, maxAnisotropy)

  // 每帧读取的运行时输入
  const runtimeRef = useRef({ nowSeconds, activeIndex, stageLines })
  runtimeRef.current = { nowSeconds, activeIndex, stageLines }

  /**
   * 构建签名：整首歌的行集合或外观设置变化时才全量重建。
   * 行窗口的进出由 useFrame 里的轨道驱动 + 懒建补齐，不再触发重建。
   */
  const signature = useMemo(
    () =>
      stageLines
        .map((line) => {
          const subs = [line.translation, line.roman].filter(Boolean).join('\u0001')
          return `${line.index}|${line.isDuet ? 1 : 0}|${line.text}|${subs}`
        })
        .join('\u0002') +
      `#${obsceneChar}` +
      // 用**生效档位**而不是用户档位：自适应收缩改变译词行数时必须重建
      `#${effectiveTranslationMode}` +
      `#${displayMode}:${customLineCount}` +
      `#${motionStyle}`,
    [stageLines, obsceneChar, effectiveTranslationMode, displayMode, customLineCount, motionStyle],
  )

  const viewportKey = `${Math.round(size.width)}x${Math.round(size.height)}`

  // ---------------------------------------------------------------- 资源释放
  const disposeRow = (row: LyricRow) => {
    row.material.dispose()
    row.texture.dispose()
    row.raster.dispose()
    row.mesh.geometry.dispose()
    disposeRowReadability(row)
    disposeRowGlow(row)
  }

  const disposeRowReadability = (row: LyricRow) => {
    if (row.readabilityMaterial) row.readabilityMaterial.dispose()
    if (row.readabilityTexture) row.readabilityTexture.dispose()
    if (row.readability) row.readability.geometry.dispose()
    row.readability = null
    row.readabilityMaterial = null
    row.readabilityTexture = null
  }

  const disposeRowGlow = (row: LyricRow) => {
    if (row.glowMaterial) row.glowMaterial.dispose()
    if (row.glowTexture) row.glowTexture.dispose()
    // 辉光层用独立几何体（世界尺寸与文字平面不同），必须单独释放
    if (row.glow) row.glow.geometry.dispose()
    row.glow = null
    row.glowMaterial = null
    row.glowTexture = null
  }

  /** 从场景摘除一行的全部网格（含可读性层与辉光层）——清理与重建共用。 */
  const detachRow = (group: THREE.Group, row: LyricRow) => {
    group.remove(row.mesh)
    if (row.readability) group.remove(row.readability)
    // ★ 辉光层也必须摘除：懒建加入的 glow 若不摘，重建/切歌后成为孤儿
    //   网格，带着最后的 opacity 永久残留（切歌都消不掉的残影根因）。
    if (row.glow) group.remove(row.glow)
  }

  // ---------------------------------------------------------------- 行构建
  /**
   * 构建单个行（栅格化 + 网格 + 材质）。
   *
   * 距离决定上下文缩放（栅格字号）与目标透明度 —— 与上游 entry.scale /
   * entry.alpha 一致，是构建时值；激活态本身逐帧重判，不在这里冻结。
   * 可读性层延迟到行首次进入渲染窗口时再建（上游效果层按需补建语义）。
   */
  const buildRow = (lineIndex: number, anchorIndex: number): LyricRow | null => {
    const group = groupRef.current
    const line = runtimeRef.current.stageLines[lineIndex]
    if (!group || !line) return null

    const distance = Math.abs(lineIndex - anchorIndex)
    // ★ 主行纹理只含主文本 —— 译词/音译是独立行（上游 translationLine），
    //   不再画进主行纹理：内嵌小字让行纹理变高但轨道行距不变，相邻行
    //   直接重叠（用户实测的"副歌词与主歌词重叠"根因）。
    const raster = rasterizeLyricLineMask({
      text: obsceneChar ? maskObsceneLine(line, obsceneChar) : line.text,
      scale: distance === 0 ? 1 : contextScaleFor(distance, contextStyle),
      duet: line.isDuet,
    })
    if (!raster) return null

    // 行平面世界宽：上游 lyricRowLogicalWorldWidth ——
    // baseWorldW * clamp(logicalWidth/2048, 1, 3)，超宽行加宽平面而非压缩字
    const lineWorldW = WORLD_W * Math.max(1, Math.min(3, raster.width / 2048))
    const lineWorldH = lineWorldW * (raster.height / raster.width)

    const geometry = new THREE.PlaneGeometry(lineWorldW, lineWorldH, 1, 1)
    const texture = new THREE.CanvasTexture(raster.canvas)
    texture.colorSpace = THREE.NoColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = lyricAnisotropy

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uProgress: { value: 0 },
        // 逐行架构里每行就是自己的文字 —— textMin/textMax 覆盖整行
        uTextMin: { value: (raster.width / 2 + raster.centerOffsetX - raster.textWidth / 2) / raster.width },
        uTextMax: { value: (raster.width / 2 + raster.centerOffsetX + raster.textWidth / 2) / raster.width },
        uOpacity: { value: 0 },
        // ★ 激活门控 uniform（上游 uActiveMix）：不再依赖纹理 R 通道 ——
        //   所有行共享同一白色栅格，R 通道无法区分行，此前扫光/节拍泛光
        //   对所有行常开（"高亮不消失"的着色器侧根因）。
        uActiveMix: { value: 0 },
        uFeather: { value: lyricFeatherFor(line) },
        uTime: { value: 0 },
        uSweep: { value: motion.sweep },
        uShimmer: { value: motion.shimmer },
        uGlitch: { value: motion.glitch },
        uGlitchSlice: { value: motion.glitchSlice },
        uGlitchChroma: { value: motion.glitchChroma },
        uGlitchRate: { value: motion.glitchRate },
        uGlitchSeed: { value: (lineIndex * 37) % 997 },
        uGlitchBurst: { value: 0 },
        uSolar: { value: 0 },
        uEdgeBoost: { value: motion.edgeBoost },
        uBaseColor: { value: new THREE.Color(colors.primary) },
        uHiColor: { value: new THREE.Color(colors.highlight) },
        uGlowColor: { value: new THREE.Color(colors.secondary) },
        uSolarColor: { value: new THREE.Color(colors.highlight) },
      },
      vertexShader: LYRIC_VERTEX_SHADER,
      fragmentShader: LYRIC_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // ★ DoubleSide（上游 11-lyrics-shaders.js:140 的
      //   makeLyricBackfaceReadableMaterial）：拖拽转的是物体组（含歌词），
      //   相机绕到平面背后时字仍要可见、并由片元的 gl_FrontFacing 分支
      //   镜像回来。此前是默认 FrontSide —— 背面整行被剔除，只剩描边层
      //   （描边/辉光本来就是 DoubleSide）留在画面上。
      side: THREE.DoubleSide,
    })

    // 行 Z / 缩放：上游 zBase 公式（构建时给初值，useFrame 逐帧驱动）
    const clampedDistance = Math.min(ROW_MAX_DELTA, distance)
    const baseZ = ROW_Z_BASE - Math.pow(clampedDistance, ROW_Z_POW) * ROW_Z_GAIN
    const baseScale = Math.max(ROW_SCALE_MIN, 1 - clampedDistance * ROW_SCALE_FALLOFF) * SHELF_AVOID_SCALE

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, 0, baseZ)
    mesh.scale.setScalar(baseScale)
    mesh.visible = false
    // 上游 renderOrder：激活 43.4，上下文 42.6-|Δ|*0.015（:456,1640）；
    // 整体 +RENDER_ORDER_OFFSET 压过卡片（见 RENDER_ORDER_OFFSET 说明）
    mesh.renderOrder = 42.6 - clampedDistance * 0.015 + RENDER_ORDER_OFFSET
    group.add(mesh)

    // 上下文行透明度链基准（构建时值，逐帧 isActive 分支决定实际亮度）：
    // ★ 即使构建时是激活行也用上下文基准 —— 否则初始激活行失活后按
    //   1×衰减 回落，比其它失活行（0.54 基准）永久亮一档（自查确认）。
    const targetAlpha =
      distance === 0
        ? Math.min(0.92, CONTEXT_OPACITY)
        : Math.max(
            CONTEXT_ALPHA_MIN,
            Math.min(0.92, CONTEXT_OPACITY - Math.max(0, distance - 0.25) * CONTEXT_ALPHA_FALLOFF),
          )

    const row: LyricRow = {
      lineIndex,
      line,
      raster,
      mesh,
      material,
      texture,
      readability: null,
      readabilityMaterial: null,
      readabilityTexture: null,
      glow: null,
      glowMaterial: null,
      glowTexture: null,
      targetAlpha,
      builtAsActive: distance === 0,
      age: 0,
      revealAt: 0,
      windowActive: false,
    }
    rowsRef.current[lineIndex] = row
    return row
  }

  /**
   * 行首次成为激活行时按 active 规格重建（上游 makeLyricLineMask 的
   * asActive 语义）：栅格 scale=1、targetAlpha=1、renderOrder=激活档。
   * 保留 windowActive/revealAt 与效果层不重建 —— 只换纹理与规格，
   * 避免"新激活行比初始激活行暗一截"。
   */
  const rebuildRowAsActive = (row: LyricRow) => {
    const group = groupRef.current
    if (!group || row.builtAsActive) return
    const line = row.line
    const raster = rasterizeLyricLineMask({
      text: obsceneChar ? maskObsceneLine(line, obsceneChar) : line.text,
      scale: 1,
      duet: line.isDuet,
    })
    if (!raster) return
    row.builtAsActive = true
    row.raster.dispose()
    row.texture.dispose()
    row.raster = raster
    // ★ targetAlpha 保持构建时的上下文基准（上游 entry.alpha 语义）：
    //   逐帧亮度 = isActive ? 1 : contextAlpha(row.targetAlpha, liveDelta)。
    //   此前在这里把 targetAlpha 永久改成 1 —— 激活过的行失活后按
    //   1×衰减 回落，比从未激活的行（0.54 基准）整体亮一档，正是
    //   "已激活过的行会一直保持亮度"的根因。

    const lineWorldW = WORLD_W * Math.max(1, Math.min(3, raster.width / 2048))
    const lineWorldH = lineWorldW * (raster.height / raster.width)
    // ★ 描边层与主网格**共享几何体**（ensureRowReadability 传入同一引用）。
    //   先释放描边/辉光层（其纹理编码旧规格字形，active 重建后不再匹配；
    //   共享的旧几何体随描边层一起 dispose），再换主网格几何体 ——
    //   下一帧由懒建逻辑按 active 栅格重建描边与辉光。
    if (row.readability) {
      group.remove(row.readability)
      disposeRowReadability(row)
    }
    if (row.glow) {
      group.remove(row.glow)
      disposeRowGlow(row)
    }
    row.mesh.geometry.dispose()
    row.mesh.geometry = new THREE.PlaneGeometry(lineWorldW, lineWorldH, 1, 1)

    const texture = new THREE.CanvasTexture(raster.canvas)
    texture.colorSpace = THREE.NoColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = lyricAnisotropy
    row.texture = texture

    const u = row.material.uniforms
    u.uMap.value = texture
    u.uTextMin.value = (raster.width / 2 + raster.centerOffsetX - raster.textWidth / 2) / raster.width
    u.uTextMax.value = (raster.width / 2 + raster.centerOffsetX + raster.textWidth / 2) / raster.width
    u.uFeather.value = lyricFeatherFor(row.line)

    // 激活档 renderOrder（上游 43.4 + 偏移）
    row.mesh.renderOrder = 43.4 + RENDER_ORDER_OFFSET
  }

  /** 行首次进入渲染窗口时补建可读性层（上游效果层按需补建语义）。 */
  const ensureRowReadability = (row: LyricRow) => {
    const group = groupRef.current
    if (!group || row.readability) return
    const readabilityCanvas = rasterizeLineReadabilityMask(row.raster)
    if (!readabilityCanvas) return
    const readabilityTexture = new THREE.CanvasTexture(readabilityCanvas)
    readabilityTexture.colorSpace = THREE.NoColorSpace
    readabilityTexture.minFilter = THREE.LinearMipmapLinearFilter
    readabilityTexture.magFilter = THREE.LinearFilter
    readabilityTexture.generateMipmaps = true
    readabilityTexture.anisotropy = lyricAnisotropy
    const readabilityMaterial = new THREE.MeshBasicMaterial({
      map: readabilityTexture,
      transparent: true,
      // 上游 readability 透明度链：readability(0.86) × readabilityMix(激活 0.74)
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
    })
    const readability = new THREE.Mesh(row.mesh.geometry, readabilityMaterial)
    readability.position.set(0, row.mesh.position.y, row.mesh.position.z - 0.012)
    readability.scale.copy(row.mesh.scale)
    readability.visible = false
    readability.renderOrder = row.mesh.renderOrder - 0.05
    group.add(readability)
    row.readability = readability
    row.readabilityMaterial = readabilityMaterial
    row.readabilityTexture = readabilityTexture
  }

  /**
   * 行首次进入渲染窗口时补建辉光层（上游 makeLyricRowGlowMesh）。
   *
   * 网格尺寸（上游 :318-336）：世界宽 = clamp(文字世界宽 + pad、
   * 文字宽×max(纹理比, 1.08)、worldW×1.08)，pad = lineWorldH×0.62；
   * 世界高按纹理真实宽高比夹 [0.66, 1.36]×lineWorldH（避免长行辉光
   * 变成过厚的扇贝带）。
   */
  const ensureRowGlow = (row: LyricRow) => {
    const group = groupRef.current
    if (!group || row.glow) return
    const glowCanvas = rasterizeLineGlowMask(row.raster)
    if (!glowCanvas) return
    const glowTexture = new THREE.CanvasTexture(glowCanvas)
    glowTexture.colorSpace = THREE.NoColorSpace
    glowTexture.minFilter = THREE.LinearMipmapLinearFilter
    glowTexture.magFilter = THREE.LinearFilter
    glowTexture.generateMipmaps = true
    glowTexture.anisotropy = lyricAnisotropy

    const lineWorldH = (row.mesh.geometry as THREE.PlaneGeometry).parameters.height
    // 上游 lineTextWorldW：worldW × (textWidth/canvasWidth)，夹 [0.10, 1.00]×worldW
    const lineTextWorldW = Math.max(
      WORLD_W * 0.1,
      Math.min(WORLD_W, WORLD_W * (row.raster.textWidth / Math.max(1, row.raster.width))),
    )
    const glowPad = lineWorldH * 0.62
    // 上游 rowGlowTextureRatio：纹理宽 / 文字像素宽（≥1）
    const rowGlowTextureRatio = Math.max(1, glowCanvas.width / Math.max(1, row.raster.textWidth))
    // 上游 rowGlowWorldW：clamp(max(textW + pad, textW×ratio), textW + pad×0.62, worldW×1.08)
    const glowWorldW = Math.min(
      WORLD_W * 1.08,
      Math.max(
        lineTextWorldW + glowPad,
        lineTextWorldW * rowGlowTextureRatio,
        lineTextWorldW + glowPad * 0.62,
      ),
    )
    // 上游 rowGlowAspect：纹理真实宽高比（防止长行辉光变成过厚的扇贝带）
    const glowAspect = Math.max(0.001, glowCanvas.height / Math.max(1, glowCanvas.width))
    const glowWorldH = Math.min(
      lineWorldH * 1.36,
      Math.max(lineWorldH * 0.66, glowWorldW * glowAspect),
    )

    const glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      // 上游辉光颜色：palette 的 secondary→highlight→primary 链，minLum 0.40
      color: new THREE.Color(glowColorForPalette(colorsRef.current)),
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(glowWorldW, glowWorldH, 1, 1), glowMaterial)
    glow.position.set(0, row.mesh.position.y, row.mesh.position.z - 0.030)
    glow.scale.copy(row.mesh.scale)
    glow.visible = false
    // 上游主行辉光 renderOrder = 42.48（相对组 base 43 固定 −0.52）
    glow.renderOrder = 42.48 + RENDER_ORDER_OFFSET
    group.add(glow)
    row.glow = glow
    row.glowMaterial = glowMaterial
    row.glowTexture = glowTexture
  }

  // ---------------------------------------------------------------- 译词独立行
  /**
   * 译词行的懒建 + 推进（上游 translationLine 条目的逐帧语义）。
   *
   * 译词行是**独立网格**：字号 ×0.52、字重 650、不参与逐字高亮（无
   * uProgress 驱动）、辉光淡得多（上游 translation 辉光分支）。
   * 虚拟槽位坐标由调用方传入（父行槽位 + TRANS_GAP），与主行同轨道。
   */
  const stepRow = (
    slotIndex: number,
    text: string,
    slot: number,
    transDelta: number,
    isCurrentParent: boolean,
    targetAlpha: number,
    windowActive: boolean,
    parentFade: number,
    dt: number,
    nowMs: number,
    currentLineGlow: number,
  ) => {
    const group = groupRef.current
    const rows = rowsRef.current
    if (!group) return
    const frameScale = Math.min(3, Math.max(0.25, dt * 60))
    const ease = 1 - Math.pow(1 - 0.16, frameScale)

    let row = rows[slotIndex]
    if (!row) {
      if (!windowActive) return
      const raster = rasterizeLyricLineMask({
        text,
        scale: 0.52,
        fontWeight: TRANS_FONT_WEIGHT,
      })
      if (!raster) return
      const lineWorldW = WORLD_W * Math.max(1, Math.min(3, raster.width / 2048))
      const lineWorldH = lineWorldW * (raster.height / raster.width)
      const geometry = new THREE.PlaneGeometry(lineWorldW, lineWorldH, 1, 1)
      const texture = new THREE.CanvasTexture(raster.canvas)
      texture.colorSpace = THREE.NoColorSpace
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.generateMipmaps = true
      texture.anisotropy = lyricAnisotropy
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: texture },
          uProgress: { value: 0 },
          uTextMin: { value: (raster.width / 2 + raster.centerOffsetX - raster.textWidth / 2) / raster.width },
          uTextMax: { value: (raster.width / 2 + raster.centerOffsetX + raster.textWidth / 2) / raster.width },
          uOpacity: { value: 0 },
          uActiveMix: { value: 0 },
          // 译词行永不参与逐字（uActiveMix 恒 0），因此取上游的"无逐字"档 0.055
          uFeather: { value: LYRIC_FEATHER_SMOOTH },
          uTime: { value: 0 },
          uSweep: { value: 0 },
          uShimmer: { value: 0 },
          uGlitch: { value: 0 },
          uGlitchSlice: { value: 0 },
          uGlitchChroma: { value: 0 },
          uGlitchRate: { value: 0 },
          uGlitchSeed: { value: 0 },
          uGlitchBurst: { value: 0 },
          uSolar: { value: 0 },
          uEdgeBoost: { value: 0 },
          uBaseColor: { value: new THREE.Color(colorsRef.current.primary) },
          uHiColor: { value: new THREE.Color(colorsRef.current.highlight) },
          uGlowColor: { value: new THREE.Color(colorsRef.current.secondary) },
          uSolarColor: { value: new THREE.Color(colorsRef.current.highlight) },
        },
        vertexShader: LYRIC_VERTEX_SHADER,
        fragmentShader: LYRIC_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // 译词行同主行：背面可读（上游统一用 backface-readable 材质）
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.visible = false
      // 上游 translation renderOrder = 主行 −0.10（压在主行之下）
      mesh.renderOrder = 42.5 + RENDER_ORDER_OFFSET
      mesh.position.set(0, 0, ROW_Z_BASE)
      mesh.scale.setScalar(SHELF_AVOID_SCALE)
      group.add(mesh)
      row = {
        lineIndex: -1,
        line: null as unknown as StageLine,
        raster,
        mesh,
        material,
        texture,
        readability: null,
        readabilityMaterial: null,
        readabilityTexture: null,
        glow: null,
        glowMaterial: null,
        glowTexture: null,
        targetAlpha,
        builtAsActive: false,
        age: 0,
        revealAt: 0,
        windowActive: false,
        isTranslation: true,
        parentIndex: slotIndex,
      }
      rows[slotIndex] = row
    }

    // ---- 推进（与主行同构，但无逐字/激活门控/辉光强链）----
    const mesh = row.mesh
    const absT = Math.abs(transDelta)
    const revealOk = windowActive
    mesh.visible = revealOk
    if (row.readability) row.readability.visible = revealOk
    if (row.glow) row.glow.visible = revealOk
    if (!revealOk) {
      if ((row.material.uniforms.uOpacity.value as number) > 0) {
        row.material.uniforms.uOpacity.value =
          (row.material.uniforms.uOpacity.value as number) * Math.pow(0.82, dt * 60)
      }
      return
    }

    const clampedDelta = Math.min(ROW_MAX_DELTA, absT)
    const zTarget = ROW_Z_BASE - Math.pow(clampedDelta, ROW_Z_POW) * ROW_Z_GAIN
    const floatY = Math.sin(nowMs / 1000 * 0.68 + slot * 0.71) * 0.008
    const yTarget = -transDelta * LYRIC_LINE_STEP_WORLD + floatY
    const depthScale = Math.max(ROW_SCALE_MIN, 1 - clampedDelta * ROW_SCALE_FALLOFF)
    const fitRatio = lyricRowFitRatio(mesh, row.raster, size.width, camera)
    const scaleTarget = depthScale * SHELF_AVOID_SCALE * fitRatio

    mesh.position.y += (yTarget - mesh.position.y) * ease
    mesh.position.z += (zTarget - mesh.position.z) * ease
    const s = mesh.scale.x + (scaleTarget - mesh.scale.x) * ease
    mesh.scale.setScalar(s)

    const uniforms = row.material.uniforms
    uniforms.uTime.value += dt
    // 译词行永不激活：uActiveMix → 0（无逐字/扫光/节拍泛光）
    uniforms.uActiveMix.value += (0 - (uniforms.uActiveMix.value as number)) * 0.48
    // 透明度：译词 alpha 基准（调用方已按上游 :1477-1495 把 parentFade
    // 算进去，这里**不得**再乘一次）× 距离淡出（上游 :1597 的
    // `opacity * (isActive ? 1 : contextAlpha) * rowIntro * visibleFade`）。
    const visibleFadeRaw = Math.max(0, Math.min(1, (visibleRadiusForTrans() + 1.1 - absT) / 1.1))
    const visibleFade = visibleFadeRaw * visibleFadeRaw * (3 - 2 * visibleFadeRaw)
    const depthFade = Math.max(0.54, 1 - absT * 0.055) * visibleFade
    const opacityTarget = targetAlpha * depthFade
    uniforms.uOpacity.value += (opacityTarget - (uniforms.uOpacity.value as number)) * ease

    ;(uniforms.uBaseColor.value as THREE.Color).set(colorsRef.current.primary)
    ;(uniforms.uHiColor.value as THREE.Color).set(colorsRef.current.highlight)
    ;(uniforms.uGlowColor.value as THREE.Color).set(colorsRef.current.secondary)
    ;(uniforms.uSolarColor.value as THREE.Color).set(colorsRef.current.highlight)

    // 可读性层：译词 mix 0.46 + focus×0.18（上游 :1685），boost ×(1+adapt×0.66)
    if (!row.readability) ensureRowReadability(row)
    if (row.readability && row.readabilityMaterial) {
      row.readability.position.y = mesh.position.y
      row.readability.position.z = mesh.position.z - 0.012
      row.readability.scale.copy(mesh.scale)
      const transMix = 0.46 + (isCurrentParent ? 0.18 : 0)
      const transBoost = 1 + BACKDROP_ADAPT * 0.66
      const target = opacityTarget * 0.86 * transMix * transBoost
      row.readabilityMaterial.opacity += (Math.min(1, target) - row.readabilityMaterial.opacity) * ease
      row.readabilityMaterial.color.set('#ffffff').lerp(
        readabilityDarkColor,
        Math.min(0.92, BACKDROP_ADAPT * 0.92),
      )
    }
    // 译词辉光：淡得多（上游 translation 辉光分支 0.30 基准）
    if (!row.glow) ensureRowGlow(row)
    if (row.glow && row.glowMaterial) {
      row.glow.position.copy(mesh.position)
      row.glow.position.z = mesh.position.z - 0.030
      row.glow.scale.copy(mesh.scale)
      row.glowMaterial.color.set(glowColorForPalette(colorsRef.current))
      const glowOpacityTarget = isCurrentParent
        ? targetAlpha * currentLineGlow * 0.46 * parentFade * depthFade
        : 0
      const g = row.glowMaterial.opacity
      let nextGlow = g + (glowOpacityTarget - g) * (glowOpacityTarget > g ? GLOW_RISE : GLOW_FALL)
      if (!isCurrentParent && nextGlow < GLOW_ZERO) nextGlow = 0
      row.glowMaterial.opacity = nextGlow
    }
  }

  /** 译词行可见半径（主行同款公式；独立函数避免每帧闭包差异）。 */
  const visibleRadiusForTrans = () => Math.max(0.85, stackLines * 0.5 * (effectiveTranslationMode !== 'off' ? SLOT_WITH_TRANS : 1))

  // ---------------------------------------------------------------- 全量重建
  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    for (const row of rowsRef.current) {
      if (row) {
        detachRow(group, row)
        disposeRow(row)
      }
    }
    rowsRef.current = []
    failedRowsRef.current = new Set()

    if (stageLines.length === 0) {
      return
    }

    // 常驻轨道：槽位覆盖整首歌；初始只建激活行 ±INITIAL_BUILD_RADIUS，
    // 其余行由 useFrame 按接近窗口懒建补齐（上游 trackPersistent 结构）
    rowsRef.current = new Array(
      stageLines.length + slotInfo.transSlot.reduce((n, t) => n + (t?.length ?? 0), 0),
    ).fill(null)
    const anchor = activeIndex >= 0 ? activeIndex : 0
    const start = Math.max(0, anchor - INITIAL_BUILD_RADIUS)
    const end = Math.min(stageLines.length - 1, anchor + INITIAL_BUILD_RADIUS)
    for (let i = start; i <= end; i++) {
      if (!buildRow(i, anchor)) failedRowsRef.current.add(i)
    }

    // 轨道对准当前激活行**的槽位**（重建即硬切换，上游 needsScrollSnap 语义）
    trackScrollRef.current = slotInfo.slotStart[anchor] ?? 0

    return () => {
      const rows = rowsRef.current
      for (const row of rows) {
        if (row) {
          detachRow(group, row)
          disposeRow(row)
        }
      }
      rowsRef.current = []
    }
    // signature 覆盖全部行内容、遮罩字符与外观设置；viewportKey 触发窗口适配重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, viewportKey])

  // ---------------------------------------------------------------- 每帧驱动
  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    const rows = rowsRef.current
    const { nowSeconds: now, activeIndex: active, stageLines: lines } = runtimeRef.current
    const dt = Math.min(delta, 1 / 20)
    const nowMs = performance.now()

    // ---- 滚动轨道（上游 :1395-1414）----
    // 轨道目标 = 激活行的**槽位**（译词行占用额外槽位，行距随内容展开）
    const target = active >= 0 ? (slotInfo.slotStart[active] ?? active) : 0
    const scroll = trackScrollRef.current
    const needsSnap = !Number.isFinite(scroll) || Math.abs(target - scroll) > Math.max(3.2, stackLines * 0.5 * 1.85)
    let newScroll: number
    if (needsSnap) {
      newScroll = target
    } else {
      const frameScale = Math.min(3, Math.max(0.25, dt * 60))
      const trackEase = 1 - Math.pow(1 - TRACK_EASE, frameScale)
      let step = (target - scroll) * trackEase
      const maxStep = TRACK_MAX_ROWS_PER_FRAME
      step = Math.max(-maxStep, Math.min(maxStep, step))
      newScroll = scroll + step
    }
    trackScrollRef.current = newScroll

    // 节拍驱动（全行共享）
    const bands = readAudioBands()
    const m = motionRef.current
    const t = nowMs / 1000

    // ---- 辉光强度链（上游 14-stage-lyrics-rendering.js :2052-2069, 2387-2391）----
    // 1) 副歌能量检测（上游 lyricSun*，11-main-loop.js:502-520）：看持续能量 +
    //    中高频抬升，更像副歌/高音段落而不是单个鼓点。平滑带用 readAudioBands
    //    的投影（energy/vocal/mid/treble = 上游 smoothEnergy/voc/smoothMid/smoothTreb）
    const glow = glowStateRef.current
    const sunEnergy = Math.max(0, Math.min(1, (bands.energy - 0.18) / 0.38))
    const sunVoice = Math.max(0, Math.min(1, (bands.vocal - 0.11) / 0.34))
    const sunMelody = Math.max(0, Math.min(1, (bands.mid - 0.16) / 0.27))
    const sunAir = Math.max(0, Math.min(1, (bands.treble - 0.105) / 0.17))
    let sunRaw = Math.max(0, Math.min(1, sunEnergy * 0.36 + sunVoice * 0.18 + sunMelody * 0.26 + sunAir * 0.2))
    sunRaw = sunRaw * sunRaw * (3 - 2 * sunRaw)
    glow.sunAvg += (sunRaw - glow.sunAvg) * 0.006
    glow.sunPeak = Math.max(0.48, glow.sunPeak * 0.9985, sunRaw)
    const sunThreshold = Math.max(0.78, glow.sunAvg + 0.2, glow.sunPeak * 0.74)
    let sunGate = Math.max(0, Math.min(1, (sunRaw - sunThreshold) / Math.max(0.08, 1.0 - sunThreshold)))
    sunGate = sunGate * sunGate * (3 - 2 * sunGate)
    glow.sunHold += (sunGate - glow.sunHold) * (sunGate > glow.sunHold ? 0.035 : 0.014)
    const sunTarget = glow.sunHold > 0.16 ? Math.max(0, Math.min(1, (glow.sunHold - 0.16) / 0.84)) : 0
    glow.sunEnergy += (sunTarget - glow.sunEnergy) * (sunTarget > glow.sunEnergy ? 0.075 : 0.03)
    // 2) beatGlow（上游 :2056-2060）：max(beatPulse×1.22, punch 项)。
    //    本项目没有 beatCam punch，只保留 beatPulse 项。
    const beatGlowRaw = bands.beat * 1.22
    glow.beatGlow += (beatGlowRaw - glow.beatGlow) * (beatGlowRaw > glow.beatGlow ? 0.32 : 0.1)
    // 3) solar/highBloom（上游 14-stage-lyrics-rendering.js:2063，非 skull 分支）：
    //    呼吸 + 持续能量 + beatGlow + sin 摆动，cap 1.45。
    const glowBreath = 0.5 + 0.5 * Math.sin(t * 1.05)
    const musicBloom = Math.max(glow.sunEnergy, bands.beat * 0.1)
    const solarBloom = Math.max(
      0,
      Math.min(
        1.45,
        (0.18 + glowBreath * 0.16 + musicBloom * 0.9 + glow.beatGlow * 1.18 + Math.sin(t * 0.37 + 1.2) * 0.035) * GLOW_DRIVE,
      ),
    )
    glow.highBloom += (solarBloom - glow.highBloom) * (solarBloom > glow.highBloom ? 0.075 : 0.05)
    // 4) 当前行辉光强度（上游 :2388-2391）：cap 1.05。
    const glowLift = GLOW_LIFT[motionStyle] ?? 1
    const currentLineGlow = Math.min(
      1.05,
      (0.1 + glow.highBloom * 0.4 + glow.beatGlow * 0.24 + bands.beat * 0.08) * Math.min(2.4, GLOW_DRIVE) * glowLift,
    )

    // 可见半径（上游 12-lyrics-row-layers.js:364：
    // max(0.85, displayLineCount * 0.50 * lyricPrimarySlotStepValue()) ——
    // 译词布局激活时主行槽位被展开，半径随之放大；否则 primarySlotStep=1
    // 退化为 ×0.5。上游的 slotStep 对"本行有译词"逐行判断，这里取保守的
    // 统一档：布局激活即用展开槽位（多算的只是缓存窗口，无视觉副作用）。
    const visibleRadius = Math.max(0.85, stackLines * 0.5 * (effectiveTranslationMode !== 'off' ? SLOT_WITH_TRANS : 1))
    /**
     * 该显示模式下**允许显示**的行偏移（上游 `lyricLineAllowedForDisplayMode`，
     * `12-lyrics-row-layers.js:80-88`）。
     *
     * ★ 此前本项目只用 `stackLines` 算了一个**对称的可见半径**，从未按模式
     *   逐一判定哪些行该显示 —— 于是：
     *     · `single`（应只显示 1 行）实际显示前后各 ~1 行
     *     · `dual`（上游是 `[0, 1]`：当前 + **下一行**，不是对称的）显示 ±2 行
     *     · `cinema` 的半径 5.3 槽位在译词展开后能容下 10+ 行
     *   上游的做法是给**不在偏移集内**的行把 `contextAlpha` 直接压到 0，
     *   半径只决定"建不建行"（这是本案与上游观感差异最大的一处）。
     */
    const allowedOffsets = new Set(lyricSlotOffsets(displayMode, customLineCount).map((o) => Math.round(o)))
    const palette = colorsRef.current

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const slot = slotInfo.slotStart[lineIndex] ?? lineIndex
      const liveDelta = slot - newScroll
      const absDelta = Math.abs(liveDelta)
      const isActive = lineIndex === active

      // ---- 译词独立行（上游 translationLine：独立网格 + 虚拟槽位）----
      // 译词行跟随父行的推进推进自己的位置/揭示/透明度链；dual 模式下
      // 只有当前行与下一行有译词（上游 :1483-1487）。
      const subs = slotInfo.transSlot[lineIndex]
      if (subs) {
        const isCurrentParent = isActive
        // ★ 父行淡出按**行距**（上游 parentDistance 语义，行单位），不是槽位差
        //   —— 槽位空间被译词展开到 1.9，(0.82−Δ)/0.34 在槽位单位下永远为 0，
        //   上下文译词不可见、dual 的"下一行"分支成死代码（自查确认）。
        const lineDist = Math.abs(lineIndex - active)
        let parentFade = Math.max(0, Math.min(1, (0.82 - lineDist) / TRANS_PARENT_FADE))
        parentFade = parentFade * parentFade * (3 - 2 * parentFade)
        if (isCurrentParent) parentFade = 1
        // dual：当前行 1、下一行 0.56、其余 0（上游 :1483-1487）
        if (effectiveTranslationMode === 'dual') {
          parentFade = isCurrentParent ? 1 : lineIndex === active + 1 ? 0.56 : 0
        }
        const subTexts = translationSubEntries(lines[lineIndex], effectiveTranslationMode)
        // ★ 译词行的最终透明度基准（上游 12-lyrics-row-layers.js:1477-1495）。
        //
        //   上游在这里就把 parentFade 用**一次**算进 contextAlpha，随后
        //   `target = opacity * (isActive ? 1 : contextAlpha) * ...`（:1597）
        //   不再重复乘。此前本项目在调用方乘一次、又在 stepRow 里乘第二次，
        //   于是：
        //     · dual 模式下一行译词只有 0.33×0.56×0.56 ≈ 0.10（上游 0.53）
        //     · multi（**出厂默认**）模式下上下文行的 parentFade 恒为 0
        //       （lineDist ≥ 1 时 (0.82−1)/0.34 < 0），译词**整行不可见**
        //   现按上游分支重写：multi 用"上下文基准与当前基准按 parentFade 混合"，
        //   其余模式用"当前基准 × parentFade"。
        const transAlpha = (() => {
          if (isCurrentParent) return TRANS_CURRENT_ALPHA
          if (effectiveTranslationMode === 'multi') {
            // contextTranslationAlpha = clamp(targetAlpha*(1−max(0,pd−0.35)*0.16), 0.08, 0.58)
            const contextTranslationAlpha = Math.max(
              TRANS_ALPHA_MIN,
              Math.min(0.58, TRANS_CONTEXT_ALPHA * (1 - Math.max(0, lineDist - 0.35) * 0.16)),
            )
            // contextAlpha = clamp(ctx*(1−fade) + current*fade, 0.08, max(0.58, current))
            return Math.max(
              TRANS_ALPHA_MIN,
              Math.min(
                Math.max(0.58, TRANS_CURRENT_ALPHA),
                contextTranslationAlpha * (1 - parentFade) + TRANS_CURRENT_ALPHA * parentFade,
              ),
            )
          }
          // current / dual：clamp(currentOpacity * parentFade, 0, currentOpacity)
          return Math.max(TRANS_ALPHA_MIN, Math.min(TRANS_CURRENT_ALPHA, TRANS_CURRENT_ALPHA * parentFade))
        })()
        // ★ 窗口门控必须按**距离**判，绝不能按 alpha 判（第二十五轮性能修复）★★
        //
        // 上游 `contextAlpha` 的 multi 分支有 `clamp(..., 0.08, ...)` 下界，
        // 因此**远行的 alpha 恒 ≥0.08、永远不为 0**。若拿 `transAlpha > 0.002`
        // 当窗口门控，就等于"整首歌的每一行译词都算在窗口内"：
        //   · 第 1 帧就把整首歌的译词行全部建出来（每行 3 个网格：主/描边/辉光）
        //   · 而效果层裁剪窗口只有 active−6 … active+24，窗口外的行每帧被
        //     dispose、下一帧又被 ensureRowReadability/ensureRowGlow 重建 ——
        //     形成**永久性的逐帧栅格化 + 纹理上传抖动**
        // 这正是用户报告的"有副歌词时整个界面更卡顿"的直接原因
        // （multi 是出厂默认译词模式，所以默认就命中）。
        //
        // 上游没有这个问题：它的译词行同样只按可见窗口建/裁
        // （14-stage-lyrics-rendering.js 的 visibleFade/裁剪窗口），
        // alpha 下界只影响**已建**行的显示亮度，不参与"要不要建"。
        //
        // 窗口取**有向**区间（前 6 / 后 24），与下方效果层裁剪窗口同源 ——
        // 用对称 ±24 会让"前方 24 行"建了又被裁，抖动只是减轻而非消除。
        const lineOffset = lineIndex - active
        const transWindowActive = lineOffset >= -TRANS_KEEP_BEFORE && lineOffset <= TRANS_KEEP_AFTER
        for (let k = 0; k < subs.length && k < subTexts.length; k++) {
          const slotIndex = lines.length + (slotInfo.transOffset[lineIndex] ?? 0) + k
          const transDelta = subs[k] - newScroll
          stepRow(
            slotIndex,
            subTexts[k],
            subs[k],
            transDelta,
            isCurrentParent,
            transAlpha,
            transWindowActive,
            parentFade,
            dt,
            nowMs,
            currentLineGlow,
          )
        }
      }

      // ---- 常驻轨道懒建（上游 trackPersistent + ensureStageLyricPersistentTrackRows）----
      // 行接近窗口（可见半径 + 预建余量）时补建；栅格化失败的行不再重试
      let row = rows[lineIndex]
      if (!row) {
        if (absDelta > visibleRadius + PREBUILD_MARGIN || failedRowsRef.current.has(lineIndex)) continue
        row = buildRow(lineIndex, Math.round(newScroll))
        if (!row) {
          failedRowsRef.current.add(lineIndex)
          continue
        }
      }

      // ---- 揭示编排（上游 :1524-1545）----
      // 行进入窗口（|liveDelta| ≤ 可见半径 + 1.1）时排一个揭示时刻
      const visibleFadeRaw = Math.max(0, Math.min(1, (visibleRadius + 1.1 - absDelta) / 1.1))
      const visibleFade = visibleFadeRaw * visibleFadeRaw * (3 - 2 * visibleFadeRaw)
      const renderWindowActive = visibleFade > 0.002 || isActive
      if (renderWindowActive && !row.windowActive) {
        row.windowActive = true
        row.revealAt = nowMs + REVEAL_BASE_MS + Math.min(5, Math.round(absDelta)) * REVEAL_LANE_MS
      } else if (!renderWindowActive && row.windowActive) {
        row.windowActive = false
        row.revealAt = 0
      }
      const revealed = row.windowActive && nowMs >= row.revealAt

      // 行存在时长（上游 mesh.userData.age，逐字进度入场加速用）
      row.age += dt

      // ---- 行位置/缩放/透明度（上游 :1597-1641）----
      const clampedDelta = Math.min(ROW_MAX_DELTA, absDelta)
      const zTarget = ROW_Z_BASE - Math.pow(clampedDelta, ROW_Z_POW) * ROW_Z_GAIN
      // 每行轻微错相浮动（上游 verticalFloat：sin(t*0.68 + seed + index*0.71)）
      const floatPhase = t * 0.68 + (lineIndex * 0.71)
      const floatY = Math.sin(floatPhase) * 0.008
      const yTarget = -liveDelta * LYRIC_LINE_STEP_WORLD + floatY

      const mesh = row.mesh
      mesh.visible = revealed
      // ★ 效果层可见性必须与主网格**每帧硬同步**（上游 row.mesh.visible =
      //   lineLayerVisible && uploaded；readability/glow 在 lineLayerVisible=false
      //   时同样被隐藏）。此前只在 revealed 分支内更新效果层 —— 行退出揭示窗口
      //   或尚未到揭示时刻时整块跳过，效果层 visible/opacity 冻结在残值，
      //   表现为"几行之前的描边残留长时间不消失"。
      if (row.readability) row.readability.visible = revealed
      if (row.glow) row.glow.visible = revealed
      if (!revealed) {
        // 未揭示/已退出窗口的行：材质透明度也要向 0 衰减（上游 visibleFade→0
        // 会把 opacityTarget 拉到 0），否则残值 opacity 会在揭示排程间隙显示
        if (row.readabilityMaterial && row.readabilityMaterial.opacity > 0) {
          row.readabilityMaterial.opacity *= Math.pow(0.82, dt * 60)
          if (row.readabilityMaterial.opacity < 0.004) row.readabilityMaterial.opacity = 0
        }
        if (row.glowMaterial && row.glowMaterial.opacity > 0) {
          row.glowMaterial.opacity *= Math.pow(0.82, dt * 60)
          if (row.glowMaterial.opacity < 0.004) row.glowMaterial.opacity = 0
        }
        if ((row.material.uniforms.uOpacity.value as number) > 0) {
          row.material.uniforms.uOpacity.value =
            (row.material.uniforms.uOpacity.value as number) * Math.pow(0.82, dt * 60)
        }
        continue
      }
      if (revealed) {
        // 效果层按需补建：行进入窗口后补上可读性层与辉光层（揭示延迟掩盖构建耗时）
        //
        // ★ 只在**裁剪窗口内**补建（第二十五轮性能修复）：裁剪窗口是
        //   active−6 … active+24，而揭示窗口是 |Δ| < 6.37（由 visibleRadius
        //   推导）。两者在**前向**不一致：lineOffset ∈ [−6.37, −6) 的行
        //   处于"揭示窗口内、裁剪窗口外"——补建出来的效果层下一帧就被裁掉，
        //   再下一帧又补建，形成逐帧栅格化抖动。这里与裁剪窗口对齐后，
        //   补建的行必然不会被裁。
        const inEffectWindow =
          lineIndex === active ||
          (lineIndex >= active - READABILITY_KEEP_BEFORE && lineIndex <= active + READABILITY_KEEP_AFTER)
        if (inEffectWindow) {
          if (!row.readability) ensureRowReadability(row)
          if (!row.glow) ensureRowGlow(row)
        }

        // 深度缩放：激活行保持原大（scaleDistance = isActive ? 0 : absDelta）
        const scaleDistance = isActive ? 0 : clampedDelta
        const depthScale = Math.max(ROW_SCALE_MIN, 1 - scaleDistance * ROW_SCALE_FALLOFF)
        // 逐行视口适配：投影行文字两端，超宽收缩（见 lyricRowFitRatio）
        const fitRatio = lyricRowFitRatio(mesh, row.raster, size.width, camera)
        const scaleTarget = depthScale * SHELF_AVOID_SCALE * fitRatio

        const ease = 1 - Math.pow(1 - 0.16, Math.min(3, Math.max(0.25, dt * 60)))
        mesh.position.y += (yTarget - mesh.position.y) * ease
        mesh.position.z += (zTarget - mesh.position.z) * ease
        const s = mesh.scale.x + (scaleTarget - mesh.scale.x) * ease
        mesh.scale.setScalar(s)

        // 材质
        const uniforms = row.material.uniforms
        uniforms.uTime.value += dt
        // ★ 激活门控逐帧重判（上游 isActive = rowLineIndex === presentationLineIndex）：
        //   逐字进度、节拍泛光、故障只属于当前激活行；行一旦失活立即回落 ——
        //   此前这些状态被冻结在构建时刻，"激活行高亮不消失"的逐帧侧根因。
        uniforms.uActiveMix.value += ((isActive ? 1 : 0) - (uniforms.uActiveMix.value as number)) * (isActive ? 0.34 : 0.62)
        if (isActive) {
          // ★ 行首次激活时按 active 规格重建（上游 asActive 语义）——
          //   懒建的行带着上下文规格（scale 0.82 / alpha 0.54），不重建
          //   就会出现"只有进页面那行高亮，之后滚到的行都偏暗"。
          if (!row.builtAsActive) rebuildRowAsActive(row)
          const activeLine = lines[active]
          if (activeLine) {
            const nextLine = lines[active + 1]
            const fallbackEnd = nextLine ? nextLine.startTime / 1000 : now + 4
            const targetProgress = computeLineProgress(activeLine, now, fallbackEnd)
            // ★ 上游 :2300-2310 的两分支：
            //   有逐字时间轴 → 直接取目标（精确贴合音频）
            //   无逐字       → 逐帧缓动追赶（否则填充按帧跳变）
            if (hasWordTiming(activeLine.words)) {
              uniforms.uProgress.value = targetProgress
            } else {
              const shown = uniforms.uProgress.value as number
              const diff = targetProgress - shown
              let progressEase = progressEaseFor(motionStyle)
              if (Math.abs(diff) > PROGRESS_BIG_JUMP) {
                progressEase = Math.max(PROGRESS_BIG_JUMP_MIN, progressEase * PROGRESS_BIG_JUMP_MUL)
              }
              if (row.age < PROGRESS_AGE_WINDOW) {
                progressEase = Math.max(progressEase, PROGRESS_AGE_MIN_EASE)
              }
              uniforms.uProgress.value = Math.max(0, Math.min(1, shown + diff * progressEase))
            }
          } else {
            uniforms.uProgress.value = 0
          }
          // uSolar 驱动源对齐上游（14-stage-lyrics-rendering.js:2414-2418）：
          // 激活行的 uSolar 跟随 highBloom（副歌持续泛光），ease 0.12 ——
          // 此前跟 bands.beat（逐拍闪烁），观感节奏与上游不同。
          const solarTarget = glow.highBloom
          uniforms.uSolar.value += (solarTarget - (uniforms.uSolar.value as number)) * 0.12
          const burstTarget = bands.bassHit ? 1 : 0
          uniforms.uGlitchBurst.value += (burstTarget - (uniforms.uGlitchBurst.value as number)) * 0.25
        } else {
          uniforms.uProgress.value = 0
          uniforms.uSolar.value += (0 - (uniforms.uSolar.value as number)) * 0.48
        }

        // 透明度（上游 :1465 + :1660）：
        //   上下文 alpha 链 = target × (1 − max(0,|Δ|−0.25)×0.070)，夹 [0.16, 0.92]
        //   —— 逐帧按 liveDelta 计算，行离开激活位后自然回落到上下文亮度。
        //   再乘距离淡出 × 揭示淡入。
        // ★ 显示模式门控（上游 12-lyrics-row-layers.js:1505-1517）：不在该模式的
        //   偏移集内 → contextAlpha 归零，整行不显示。半径只管"建不建行"。
        const modeAllowed = isActive || allowedOffsets.has(roundToLineOffset(lineIndex - active))
        const contextAlpha = !modeAllowed
          ? 0
          : isActive
            ? 1
            : Math.max(CONTEXT_ALPHA_MIN, Math.min(0.92, row.targetAlpha - Math.max(0, absDelta - 0.25) * CONTEXT_ALPHA_FALLOFF))
        const depthFade = isActive ? 1 : Math.max(0.54, 1 - absDelta * 0.055) * visibleFade
        const opacityTarget = contextAlpha * depthFade
        uniforms.uOpacity.value += (opacityTarget - (uniforms.uOpacity.value as number)) * ease

        // 配色跟随封面调色板
        ;(uniforms.uBaseColor.value as THREE.Color).set(palette.primary)
        ;(uniforms.uHiColor.value as THREE.Color).set(palette.highlight)
        ;(uniforms.uGlowColor.value as THREE.Color).set(palette.secondary)
        ;(uniforms.uSolarColor.value as THREE.Color).set(palette.highlight)

        // 可读性层跟随主网格
        if (row.readability && row.readabilityMaterial) {
          row.readability.visible = mesh.visible
          row.readability.position.y = mesh.position.y
          row.readability.position.z = mesh.position.z - 0.012
          row.readability.scale.copy(mesh.scale)
          // 上游 :1685-1690：backdropAdapt 提升描边 mix 并整体加权
          const baseMix = isActive ? 0.74 : 0.52
          const readabilityMix = Math.max(baseMix, 0.6 + BACKDROP_ADAPT * 0.12)
          const readabilityBoost = 1 + BACKDROP_ADAPT * 0.78
          const readabilityTarget = opacityTarget * 0.86 * readabilityMix * readabilityBoost
          row.readabilityMaterial.opacity +=
            (Math.min(1, readabilityTarget) - row.readabilityMaterial.opacity) * ease
          // 描边颜色向近黑 lerp（亮底避光，上游 lyricReadabilityColorForBrightBackdrop）
          row.readabilityMaterial.color.set('#ffffff').lerp(
            readabilityDarkColor,
            Math.min(0.92, BACKDROP_ADAPT * 0.92),
          )
        }

        // ---- 辉光层（上游 :1708-1729）----
        // 跟随主网格（上游 glowLockedToText 分支：position/scale 直连 set），
        // z −0.030；透明度目标 = 激活行 target×rowGlow×(1+rowGlowBeat×0.46)×depthFade，
        // 非激活主行为 0（辉光只跟激活行）；渐变升 0.20 / 降 0.34。
        if (row.glow && row.glowMaterial) {
          row.glow.visible = mesh.visible
          row.glow.position.x = mesh.position.x
          row.glow.position.y = mesh.position.y
          row.glow.position.z = mesh.position.z - 0.030
          row.glow.scale.copy(mesh.scale)
          // 辉光颜色跟随封面调色板（上游 setLyricMaterialColor 每帧同步）
          row.glowMaterial.color.set(glowColorForPalette(palette))
          const rowGlowBeat = Math.max(0, Math.min(1.5, glow.beatGlow))
          const glowOpacityTarget = isActive
            ? row.targetAlpha * currentLineGlow * (1 + rowGlowBeat * 0.46) * depthFade
            : 0
          const glowOpacity = row.glowMaterial.opacity
          let nextGlowOpacity =
            glowOpacity +
            (glowOpacityTarget - glowOpacity) * (glowOpacityTarget > glowOpacity ? GLOW_RISE : GLOW_FALL)
          if (!isActive && nextGlowOpacity < GLOW_ZERO) nextGlowOpacity = 0
          row.glowMaterial.opacity = nextGlowOpacity
        }
      }
    }

    // ---- 效果层裁剪（上游 trimStageLyricPersistentTrackRows：keepStart=target−6，
    //      keepEnd=target+24）---- 窗口外的可读性/辉光层释放；文本行常驻（保证轨道连续）
    // ★ 前半区按主行索引比 keepLo/keepHi（主行索引语义）；
    //   后半区是译词独立行（rows 下标 ≥ lines.length），裁剪按其**父行**
    //   是否在窗口内判断 —— 直接用槽位下标比 keepLo/keepHi 会把译词行
    //   全部判为窗口外，每帧 dispose/重建造成抖动。
    const keepLo = active - READABILITY_KEEP_BEFORE
    const keepHi = active + READABILITY_KEEP_AFTER
    for (let slotIndex = 0; slotIndex < rows.length; slotIndex++) {
      const row = rows[slotIndex]
      if (!row) continue
      let inKeepWindow: boolean
      if (slotIndex < lines.length) {
        inKeepWindow = slotIndex === active || (slotIndex >= keepLo && slotIndex <= keepHi)
      } else {
        // 译词行：父行索引 = transOffset 反查（保持线性扫描，行数有限）
        let parent = -1
        for (let i = 0; i < lines.length; i++) {
          const off = slotInfo.transOffset[i] ?? 0
          const count = slotInfo.transSlot[i]?.length ?? 0
          if (count > 0 && slotIndex >= lines.length + off && slotIndex < lines.length + off + count) {
            parent = i
            break
          }
        }
        inKeepWindow = parent >= 0 && parent >= keepLo && parent <= keepHi
      }
      if (inKeepWindow) continue
      if (row.readability) {
        group.remove(row.readability)
        disposeRowReadability(row)
      }
      if (row.glow) {
        group.remove(row.glow)
        disposeRowGlow(row)
      }
    }

    // ---- 歌词组姿态：锚定封面世界四元数（上游 free 分支 :2190-2204）----
    const floatYGroup = Math.sin(t * 0.55) * 0.02 * m.floatAmp
    const layoutScale = 1

    if (coverPose.active) {
      coverQuat.set(
        coverPose.quaternion.x,
        coverPose.quaternion.y,
        coverPose.quaternion.z,
        coverPose.quaternion.w,
      )
      group.quaternion.copy(coverQuat)
      group.position.set(
        coverPose.position.x,
        coverPose.position.y + floatYGroup,
        coverPose.position.z + LYRIC_PLANE_Z,
      )
    } else {
      group.quaternion.identity()
      // 固定姿态分支 = 地形模式专属；抬升量让主行落在舞台视觉中心
      group.position.set(-SHELF_AVOID_X, SHELF_AVOID_Y + TOPOGRAPHY_LIFT_Y + floatYGroup, LYRIC_PLANE_Z + SHELF_AVOID_Z)
    }
    group.scale.setScalar(layoutScale * (1 + Math.sin(t * 0.48) * 0.006 * m.breathe))

    // 把歌词世界位置发布出去，供相机看向它（上游 readSonicLyricLookAtTarget）
    lyricWorldPos.x = group.position.x
    lyricWorldPos.y = group.position.y
    lyricWorldPos.z = group.position.z
    lyricWorldPos.active = true
  })

  // 卸载兜底清理
  useEffect(() => {
    const rows = rowsRef.current
    const group = groupRef.current
    return () => {
      if (group) {
        for (const row of rows) {
          if (row) {
            group.remove(row.mesh)
            if (row.readability) group.remove(row.readability)
            // 辉光层也必须摘（与 detachRow 同规）——漏摘即成孤儿网格残留
            if (row.glow) group.remove(row.glow)
          }
        }
      }
      for (const row of rows) if (row) disposeRow(row)
      rowsRef.current = []
      lyricWorldPos.active = false
    }
    // 卸载兜底：只跑一次，引用的 rows/group 是捕获的 ref 快照
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <group ref={groupRef} />
}
