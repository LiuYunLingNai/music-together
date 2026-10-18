import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { readShelfLyricAvoid } from '../particles/shelfSummonState'
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
  getMotionProfile,
  lyricLineCountForMode,
  lyricSlotOffsets,
  retractTranslationMode,
  type LyricDisplayMode,
  type LyricMotionStyle,
  type LyricTranslationMode,
} from './lyricDisplayConfig'
import { DEFAULT_PALETTE, type CoverPalette } from './coverPalette'
import { readAudioBands } from '../../stages/AudioAnalyser'
import { detectHardwareProfile } from '../../stages/RenderPolicy'
import { coverPose, lyricWorldPos } from '../particles/gestureRotationState'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import { buildAMLLLinesFromLrc } from '@/lib/lyricLrc'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'
import { maskObsceneLine, type ObsceneMaskMode } from './obsceneMask'

/** 世界尺寸，参照 Mineradio 的 worldW（上游 6.10） */
const WORLD_W = 6.1

/**
 * 歌词平面的世界 Z 位置（Mineradio 原值 1.46）。
 */
const LYRIC_PLANE_Z = 1.46

/**
 * 上下文行的基准透明度（上游 `stageLyricTrackBaseEntry` 的
 * `clampRange(lyricContextOpacityValue(), 0.18, 0.92)`，出厂 0.54）。
 *
 * ★ 每一行都是同一个基准，与"离激活行多远"无关 —— 距离衰减在逐帧
 *   `contextAlpha` 里做一次（`:1464`）。此前构建时先按距离减一次、
 *   逐帧再减一次，上下文行比上游暗一档。
 */
const CONTEXT_OPACITY = 0.54

/**
 * 当前行的全局不透明度（上游 `shelfDetailLyricProfile.opacity`，出厂 0.96）。
 *
 * 上游 `target = opacity × (isActive ? 1 : contextAlpha) × rowIntro × visibleFade`，
 * 激活行因此是 0.96 而非 1。它同时是辉光链的基准 —— 辉光乘的是 `target`
 * 而不是行的上下文 α。
 */
const CURRENT_LINE_OPACITY = 0.96

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
 * 译词独立行（上游 08-lyrics-display-modes.js 的虚拟槽位 + 12-/14-...js 的
 * translationLine 条目 —— 译词是**独立网格**，绝不与主行同纹理）：
 *
 *   - 有译词的行（或其前一行有）占用更多主行槽位（见 `SLOT_WITH_TRANS`）
 *   - 译词行挂在父行 +`TRANS_GAP` 处
 *   - 滚动轨道以虚拟槽位为单位推进，主行与译词行各占各的槽 ——
 *     重叠在结构上不可能发生（此前译词画进主行纹理，行距不随纹理
 *     变高而展开，相邻行直接叠字）
 *
 * 下面四个常量是这套槽位体系的全部数值来源，逐个对照上游出厂值修正过。
 */
/**
 * 无译词主行的槽位步长。
 *
 * 上游 `08-lyrics-display-modes.js:69-72` 的 `lyricLineSlotStepValue()`：
 *   `clampRange(1.04 + (lyricContextSpreadValue() - 1) * 0.10, 0.96, 1.24)`
 * 出厂 `lyricContextSpread: 1.96`（`00-state/04-fx-defaults.js:42`）
 *   → `clamp(1.04 + 0.96×0.10, 0.96, 1.24)` = **1.136**
 *
 * 此前写 1.0 —— 那是上游 `lyricTranslationLayoutActive() === false` 时的
 * 提前返回值，而出厂 `lyricTranslationMode: 'multi'`（:32）下该分支不成立。
 */
const SLOT_PLAIN = 1.136
/**
 * 同一主行的多条译词（译词 + 音译）之间的槽位间距。
 *
 * 上游 `applyLyricTranslationModeToEntries` 的 multi 分支
 * （14-stage-lyrics-rendering.js:2740-2746）对每行**只插一条**译词行，
 * 没有"同主行第二条译词"的概念，因此上游没有对应的显式步长常量。
 *
 * 本项目的 `roman`（音译）是自有的第二条译词。取 `1.06`：
 * 它与上游把译词行距在 `lyricTrackLineStepWorld` 基础上放的 `×1.06`
 * 同源（12-lyrics-row-layers.js:40），保持"槽位单位 = 主行步长"的口径。
 * 此前这里是硬编码的 0.5，比一个主行步长（2.1214）窄 4 倍多。
 */
const TRANS_SUB_STEP = 1.06
/**
 * 槽位 → 世界坐标的步长（world per slot），对应上游
 * `12-lyrics-row-layers.js:32-41` 的 `lyricTrackLineStepWorld()`。
 *
 * 上游推导（高度项**完全约掉**，所以与画布高度档位无关）：
 *
 *   worldH = 6.10 × (maskH / maskW)                 13-lyrics-mesh-build.js:49-50
 *   step   = worldH × (lineHeight / maskH)
 *          = 6.10 × lineHeight / maskW
 *
 *   行网格用 `stableStageLyricRowMaskLayout()`（:20-24）锁定的布局：
 *     lineHeight = 128 × lyricLineHeightFactor() = 128 × 1.0 = 128
 *     （`fx.lyricLineHeight` 出厂 1.0，见 04-fx-defaults.js:50；
 *       上游源码里的 1.08 只是 `typeof !== 'function'` 的兜底，不是出厂值）
 *   maskW 基宽 2048 →  step_base = 6.10 × 128 / 2048 = **0.38125**
 *
 * ★ 这就是此前硬编码的 0.38 —— 它只抄到了上游的**基准**，
 *   漏掉了紧随其后的两个乘子（12-lyrics-row-layers.js:38-40）：
 *
 *     step *= clampRange(1 + (lyricContextSpreadValue() - 1) * 0.32, 0.86, 1.45)
 *          →  1 + 0.96 × 0.32 = 1.3072        （出厂 spread 1.96）
 *     if (lyricTranslationLayoutActive()) step *= 1.06
 *          →  ×1.06                            （出厂 translationMode 'multi'）
 *
 *   0.38125 × 1.3072 × 1.06 = 0.528272…，在上游夹区 [0.22, 0.94] 内。
 *   行距因此比此前**宽 39%** —— 这是歌词区最大的单项视觉偏差。
 */
const LYRIC_LINE_STEP_BASE_WORLD = 6.1 * 128 / 2048
const LYRIC_CONTEXT_SPREAD = 1.96
const LYRIC_LINE_STEP_WORLD = Math.min(
  0.94,
  Math.max(
    0.22,
    LYRIC_LINE_STEP_BASE_WORLD * Math.min(1.45, Math.max(0.86, 1 + (LYRIC_CONTEXT_SPREAD - 1) * 0.32)) * 1.06,
  ),
)
/**
 * 译词行**独立**的步长，对应上游 `12-lyrics-row-layers.js:42-49` 的
 * `lyricTranslationLineStepWorld()` —— 同一个 0.38125 基准，但
 * **不乘 spread 因子**，只乘 `×1.04`，夹区 [0.20, 0.78]：
 *
 *   0.38125 × 1.04 = 0.3965
 *
 * ★ 上游译词行的 Y **不走主行步长**（:63 / :77）：
 *     y = -parentDelta × lineStepWorld − sign × visualGap × translationLineStepWorld
 *   主行间距用宽的那个（0.5283），"主行→译词"用窄的这个（0.3965）。
 *   此前本项目把译词 Y 也按主行步长换算，等于把这两个量混成一个。
 */
const LYRIC_TRANSLATION_STEP_WORLD = Math.min(0.78, Math.max(0.2, LYRIC_LINE_STEP_BASE_WORLD * 1.04))

/** 1 栅格 px 对应的世界长度（遮罩画布 2048 基宽映射到 WORLD_W）。 */
const WORLD_PER_RASTER_PX = WORLD_W / LYRIC_MASK_BASE_WIDTH
/** 主行字号的世界尺寸（栅格字号 128px）。 */
const MAIN_FONT_WORLD = LYRIC_FONT_SIZE * WORLD_PER_RASTER_PX
/**
 * 译词字号相对主行的比例（栅格 scale），上游 `makeStageLyricTranslationEntry`
 * （`14-stage-lyrics-rendering.js:2698`）：
 *
 *   isCurrent ? clamp(scale × 1.08, 0.70, 1.12) : clamp(scale × 0.92, 0.50, 0.96)
 *
 * 出厂 `lyricTranslationScale: 0.65`（04-fx-defaults.js:44）：
 *   当前行 → 0.65 × 1.08 = **0.702**
 *   上下文 → 0.65 × 0.92 = **0.598**
 *
 * ★ 此前固定 0.52，译词比上游小约 26%（当前行）／13%（上下文），
 *   是"译文看起来比原版小一号"的直接原因。取当前行档作为间距校验的下界。
 */
const TRANS_CURRENT_FONT_SCALE = 0.702
const TRANS_CONTEXT_FONT_SCALE = 0.598
const TRANS_FONT_SCALE = 0.702

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
 * 主歌词 → 译词的偏移量，对应上游 `08-lyrics-display-modes.js:50-54` 的
 * `lyricTranslationVisualGapValue()`：
 *
 *   clampRange(0.98 + (gap − 0.28) × 0.36 + max(0, scale − 0.66) × 0.12, 0.92, 2.20)
 *
 * 出厂 `lyricTranslationGap: 0.92` / `lyricTranslationScale: 0.65`
 * （04-fx-defaults.js:43-44）：
 *   0.98 + (0.92 − 0.28) × 0.36 + max(0, −0.01) × 0.12 = 0.98 + 0.2304 = **1.2104**
 *
 * ★ 此前这里取 `2.1214 / 2 = 1.0607`，是一处**刻意偏离**：当时认为上游
 *   "译词离自己的主歌词远、离下一句近"的分布不合观感，于是把整段间距均分。
 *   本轮按"尽可能接近上游视觉效果"的要求回归上游原值 —— 且换算到世界距离
 *   后，上游本来就近乎均分（见下），当年那个"不合观感"的判断在槽位空间
 *   成立、在世界空间并不成立。
 *
 * ★ 同时修正量纲：上游这个值**不是**乘在主行步长上的槽位数，而是乘在
 *   **译词独立步长** `LYRIC_TRANSLATION_STEP_WORLD` 上的系数（:63 / :77）。
 *   上游实际世界间距：
 *     主行 → 译词      = 1.2104 × 0.3965 = 0.4800
 *     译词 → 下一主行  = 2.1214 × 0.5283 − 0.4800 = 0.6410
 *   槽位空间的不对称（1.2104 vs 0.9110）被两个步长之差抵消，
 *   换算成**字形边缘间距**后几乎相等（0.1902 vs 0.1915，比值 0.993）——
 *   上游观感上译词近似居中在自己的主行与下一句之间。
 */
const TRANS_GAP = 1.2104
/** 译词行的字形高度（世界单位），供间距校验与测试使用。 */
export const TRANS_GLYPH_TOUCH_WORLD = glyphTouchDistance(MAIN_FONT_WORLD, MAIN_FONT_WORLD * TRANS_FONT_SCALE)
/**
 * 译词与主歌词之间的实际字形边缘间距（世界单位；负值 = 重叠）。
 * 按上游量纲用**译词独立步长**换算。
 */
export const TRANS_GLYPH_GAP_WORLD = TRANS_GAP * LYRIC_TRANSLATION_STEP_WORLD - TRANS_GLYPH_TOUCH_WORLD

/**
 * 有译词行的主行槽位步长 —— 上游 `08-lyrics-display-modes.js:58-61` 的
 * `lyricPrimarySlotStepValue()`：
 *
 *   clampRange(visualGap + 0.82 + translationScale × 0.14, 1.78, 2.88)
 *   →  1.2104 + 0.82 + 0.65 × 0.14 = **2.1214**
 *
 * 只在 `lyricTranslationLayoutActive()`（出厂 'multi'）时生效；否则返回 1。
 */
const SLOT_WITH_TRANS = 2.1214
/**
 * 当前译词行的 contextAlpha（上游 `12-lyrics-row-layers.js:1477-1494`）。
 *
 * 轨道分支里 `currentTranslationOpacity = lyricTranslationOpacityValue()`，
 * 当前父行的 `parentFade = 1` ⇒ 两条公式都收敛到它：
 *   non-multi: clamp(currentOpacity × 1, 0, currentOpacity)
 *   multi    : clamp(ctxTrans × 0 + currentOpacity × 1, 0.08, max(0.58, currentOpacity))
 * 出厂 `lyricTranslationOpacity: 0.86`（04-fx-defaults.js:45）。
 *
 * ★ 此前取 0.94 —— 那是**条目** `entry.alpha`（clamp(0.86+0.08, 0.48, 1)），
 *   只在非轨道的上下文条目路径里使用，轨道里从不参与 contextAlpha。
 */
const TRANS_CURRENT_ALPHA = 0.86
/**
 * 上下文译词条目的透明度基准（上游 14-stage-lyrics-rendering.js:2697）：
 *
 *   clamp(entry.alpha × 0.62, 0.24, 0.60)
 *
 * 轨道条目的 `entry.alpha` = clamp(lyricContextOpacity 0.54, 0.18, 0.92) = 0.54，
 * 故 0.54 × 0.62 = **0.3348**。multi 模式的上下文混合以它为起点。
 */
const TRANS_CONTEXT_ALPHA = 0.3348
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
 * x −1.36、y +0.06、z +0.72。
 *
 * ============================ 上游的真实门控 ============================
 *
 * 上游 `14-stage-lyrics-rendering.js:2117-2123`：
 *
 *   var layoutScale = clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65);
 *   ...
 *   } else if (!skullMouthLyrics && shelfLyricAvoid && fx.lyricCameraLock) {
 *     layoutScale *= 0.72;  layoutX -= 1.36;  layoutY += 0.06;  layoutZ += 0.72;
 *   }
 *
 * 也就是说 `×0.72` **只在 `shelfLyricAvoid && fx.lyricCameraLock` 同时成立时**
 * 生效，而 `lyricCameraLock` 出厂 **false**（00-state/04-fx-defaults.js:97）。
 * 上游静止态歌词**完全不缩**，`layoutScale` 恒为 `clamp(fx.lyricScale, ...)` = 1.0。
 *
 * ★★ 本项目此前把 `×0.72` **无条件乘到每一行**上，原因与
 *   `SHELF_CENTER.x` 的偏离同源：歌单架当时常驻可见，不缩就会真的撞上。
 *   召唤包络（`particles/shelfSummonState`）移植后该前提已消失。
 *
 * ★ 现在按上游口径，缩放因子由**召唤包络**驱动：
 *   `shouldAvoidStageLyricsForShelf(state)`（上游
 *   03-focus-cinema-camera.js:170-176）在 `shelfVisibility > 0.24` 或
 *   `hoverCue.value > 0.28` 时成立 —— 即**歌单架浮现时**才避让。
 *   本项目没有 `fx.lyricCameraLock` 开关，因此那个附加条件不再要求
 *   （否则避让永远不会触发，等于回到"常驻可见"的老问题）。
 *
 *   位移三项仍**刻意不用**：上游它们配合 camera-lock 使用，本项目歌词恒定
 *   世界锚定在封面中心、相机恒定看向封面 —— 单独套用位移会让歌词离开封面
 *   轴心，封面旋转时明显错位。
 *
 *   `SHELF_AVOID_X/Z` 仍被地形固定姿态分支引用（无封面 / 无 camera-lock，
 *   上游无对应场景，属本项目自有布局）。
 */
const SHELF_AVOID_SCALE = 0.72
/**
 * 歌词布局缩放 —— 上游 `layoutScale`（14-stage-lyrics-rendering.js:2082）。
 *
 * 静止态 = 1.0（上游 `clamp(fx.lyricScale, 0.35, 1.65)`，出厂 `lyricScale: 1`）；
 * 歌单架浮现时 = 0.72（上游 :2117 的 `layoutScale *= 0.72`，由
 * `shouldAvoidStageLyricsForShelf` 驱动，见 `SHELF_AVOID_SCALE` 上方注释）。
 *
 * 每帧读一次发布槽，避免在四处置入同一段条件。
 */
function lyricShelfAvoidScale(): number {
  return readShelfLyricAvoid() ? SHELF_AVOID_SCALE : 1
}
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
 *
 * 透明度目标值（上游 :1718-1729，三条路径共用一个尾部压暗项）：
 *
 *   isActive   → target × rowGlow × (1 + rowGlowBeat×0.46) × depthFade
 *   译词·当前  → target × rowGlow × (0.46 + rowGlowBeat×0.08) × focus × depthFade
 *   译词·非当前→ target × rowGlow × (0.30 + rowGlowBeat×0.06) × focus × depthFade
 *   其余主行   → 0
 *   之后：if (backdropAdapt > 0.001) ×= (1 − backdropAdapt×0.30)
 *
 * ★ 压暗项是**无条件**乘的（只要 adapt > 0.001），因此三条路径都要带。
 *   上游 `lyricBackgroundAdapt`（出厂 0.72）在亮封面下同时压暗辉光与
 *   加重描边 —— 只做一半的话，亮底下描边变重而辉光依旧满亮度，
 *   等于在亮底上又叠一层亮，文字反而更糊。
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

/**
 * smoothstep —— 上游组级包络 `a = a*a*(3 - 2*a)`（`tickMesh`，:2221）。
 *
 * 必须是 smoothstep 而不是线性：上游换行的滑入是"先快后慢"的，
 * 线性插值会让新行**匀速**滑上来，观感偏机械。
 */
function smoothstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/**
 * 歌词调色板补间（上游 `setStageLyricPalette`，`07-lyrics-palette-text-utils.js:217-243`）。
 *
 * ============================ 为什么需要 ============================
 *
 * 调色板由**封面**主导（`stageLyrics.coverPalette`）。本项目此前每帧
 * `(color as THREE.Color).set(palette.primary)` —— 封面加载完成、切歌、
 * 或暗色封面触发 `BACKDROP_ADAPT` 时，歌词颜色**瞬间跳变**。
 *
 * 上游是 520ms 的 smoothstep 补间，且逐通道插值
 * （`lerpStageLyricPaletteColor`，夹 120~1200ms）。因此这里维护一份
 * "当前显示中的调色板"，每帧朝目标靠近；目标没变时就地不动。
 *
 * ★ 与上游的差异：上游用 rAF 自起一段补间并在完成时写终值；本项目没有
 *   独立的补间调度器（颜色在 useFrame 里逐帧写），改为**每帧按 dt 推进**
 *   同一个 smoothstep —— 数学等价，且天然跟随渲染循环（标签页切走时
 *   不会像 rAF 那样停在中途）。
 */
const LYRIC_PALETTE_TWEEN_MS = 520

/** 补间态：当前显示中的调色板 + 目标 + 已耗时。 */
const paletteTween = {
  current: new THREE.Color(),
  highlight: new THREE.Color(),
  secondary: new THREE.Color(),
  targetPrimary: new THREE.Color(),
  targetHighlight: new THREE.Color(),
  targetSecondary: new THREE.Color(),
  /** 已耗时（ms）。`-1` = 尚未开始（首帧）。 */
  elapsed: -1,
}

/**
 * 推进调色板补间，返回当前应显示的三色。
 *
 * 状态机：
 *   · `elapsed < 0`（首帧）      → 直接落位，不补间
 *   · 目标变了                   → 当前显示值留作起点、计时归零
 *   · 计时 < 520ms              → smoothstep 靠近
 *   · 计时 ≥ 520ms              → 落终值（避免无限逼近）
 *
 * @param dt     本帧时长（秒）
 * @param target 目标调色板
 */
function stepLyricPalette(
  dt: number,
  target: { primary: string; highlight: string; secondary: string },
): { primary: THREE.Color; highlight: THREE.Color; secondary: THREE.Color } {
  const { current, highlight, secondary, targetPrimary, targetHighlight, targetSecondary } = paletteTween
  targetPrimary.set(target.primary)
  targetHighlight.set(target.highlight)
  targetSecondary.set(target.secondary)

  if (paletteTween.elapsed < 0) {
    paletteTween.elapsed = 0
    current.copy(targetPrimary)
    highlight.copy(targetHighlight)
    secondary.copy(targetSecondary)
    return { primary: current, highlight, secondary }
  }

  const changed =
    !targetPrimary.equals(current) || !targetHighlight.equals(highlight) || !targetSecondary.equals(secondary)
  if (changed) paletteTween.elapsed = 0

  if (paletteTween.elapsed >= LYRIC_PALETTE_TWEEN_MS) {
    current.copy(targetPrimary)
    highlight.copy(targetHighlight)
    secondary.copy(targetSecondary)
    return { primary: current, highlight, secondary }
  }

  const t = smoothstep(Math.min(1, paletteTween.elapsed / LYRIC_PALETTE_TWEEN_MS))
  current.lerp(targetPrimary, t)
  highlight.lerp(targetHighlight, t)
  secondary.lerp(targetSecondary, t)
  paletteTween.elapsed += Math.max(0, dt) * 1000
  return { primary: current, highlight, secondary }
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
  const motion = getMotionProfile(motionStyle)
  const colors = palette ?? DEFAULT_PALETTE

  // 时间偏移校准：沿用与 AMLL 相同的口径
  const offsetKey = getLyricOffsetKey(currentTrack)
  const offsetMs = lyricOffsets[offsetKey ?? ''] ?? 0
  const nowSeconds = Math.max(0, currentTime - offsetMs / 1000)

  // 逐字数据优先；没有 ttmlLines 时用 LRC 文本兜底
  const stageLines = useMemo<StageLine[]>(() => {
    if (ttmlLines && ttmlLines.length > 0) return buildStageLines(ttmlLines)
    const fallback = buildAMLLLinesFromLrc(lyric, tlyric)
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
      if (subs.length > 0) {
        transSlot[i] = subs.map((_, k) => s + TRANS_GAP + k * TRANS_SUB_STEP)
      }
      else transSlot[i] = null
      const prevHas = i > 0 && translationSubEntries(stageLines[i - 1], effectiveTranslationMode).length > 0
      s += subs.length > 0 || prevHas ? SLOT_WITH_TRANS : SLOT_PLAIN
      t0 += subs.length
    }
    slotStart[stageLines.length] = s
    transOffset[stageLines.length] = t0
    return { slotStart, transSlot, transOffset }
  }, [stageLines, effectiveTranslationMode])

  // 掩码字符：仅在启用掩码模式时替换。
  // ★ 三态（'' / full-mask / partial-mask）必须完整透传 —— 折叠成布尔会让
  //   partial-mask 与 full-mask 表现相同（见 `maskObsceneLine` 说明）。
  const obsceneMode: ObsceneMaskMode = maskMode || ''
  const obsceneChar = obsceneMode ? maskObsceneChar || '*' : ''

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

  /**
   * 歌词**组级**运动的三个跨帧量（上游 `tickMesh` 的 `mesh.userData`）：
   *
   *   · `age`       包络进度（秒）。上游 `mesh.userData.age`，换行时置 0
   *                 （:2213-2219），每帧 `+= dt`；`a = age/enter` 再 smoothstep。
   *   · `seed`      浮动/摆动的相位（上游 `userData.floatSeed = random()*100`）。
   *                 固定值而非逐帧随机 —— 否则浮动会抖。
   *   · `velocity`  上一次滚动增量，用于推 `enterDirection`
   *                 （上游 `lineStep > 0 ? -1 : 1`）。
   *
   * `shownProgressRef` 单独放在下面（由逐字推进处写）。
   */
  const groupAgeRef = useRef(0)
  const floatSeedRef = useRef(Math.random() * 100)
  const trackVelocityRef = useRef(1)
  /** 当前激活行的逐字进度（0..1）—— 组级 `progressLift` 的输入。 */
  const shownProgressRef = useRef(0)
  /** 上一次的激活行索引 —— 用于判"换行"以重置组级包络。 */
  const lastActiveIndexRef = useRef(-1)
  /**
   * 行级 rot.z 摆动目标（上游 :2487 的 `rootRotationTarget`）。
   *
   * 由组姿态段算出、行循环消费。之所以走 ref 而不是在两处各算一遍：
   * 它依赖 `seed` 与 `motionStyle`，分叉成两份就会有不同步的一天。
   */
  const rowRootRotationRef = useRef(0)

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
      // ★ 必须含**掩码模式**，不能只放掩码字符：full-mask 与 partial-mask
      //   用的是同一个字符，只放字符的话两者切换不会触发重建 ——
      //   纹理仍是旧模式画的，设置看起来"没生效"。
      `#${obsceneMode}:${obsceneChar}` +
      // 用**生效档位**而不是用户档位：自适应收缩改变译词行数时必须重建
      `#${effectiveTranslationMode}` +
      `#${displayMode}:${customLineCount}` +
      `#${motionStyle}`,
    [stageLines, obsceneMode, obsceneChar, effectiveTranslationMode, displayMode, customLineCount, motionStyle],
  )

  // ★ 这里**不要**把视口尺寸放进重建依赖。
  //
  //   曾经的错法：`const viewportKey = \`${size.width}x${size.height}\`` 并
  //   作为重建 effect 的依赖，注释写"触发窗口适配重算"。但重建路径**从不
  //   读 size** —— 逐行视口适配（`lyricRowFitRatio`）是在**每帧**用实时
  //   `size.width` 算的（见 `stepRow` 与主循环）。于是拖动窗口边缘时，
  //   每个 resize 事件（每秒数十次）都会把整条常驻轨道拆掉重建：
  //   `rowsRef.current = []` + 全部行 detach/dispose + 重新栅格化 ±7 行
  //   （每行一张 2048 宽画布 + 文字测量 + 可读性/辉光多遍）—— 表现为
  //   数秒卡顿，且刚建好的行全部丢弃（常驻轨道的意义被抹掉）。
  //
  //   逐行 fit 已经是逐帧的，因此视口变化**不需要**重建：行会在下一帧
  //   自动适配新宽度。

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
      text: obsceneChar ? maskObsceneLine(line, obsceneMode, obsceneChar) : line.text,
      scale: 1,
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
    const baseScale = Math.max(ROW_SCALE_MIN, 1 - clampedDistance * ROW_SCALE_FALLOFF) * lyricShelfAvoidScale()

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, 0, baseZ)
    mesh.scale.setScalar(baseScale)
    mesh.visible = false
    // 上游 renderOrder：激活 43.4，上下文 42.6-|Δ|*0.015（:456,1640）；
    // 整体 +RENDER_ORDER_OFFSET 压过卡片（见 RENDER_ORDER_OFFSET 说明）
    mesh.renderOrder = 42.6 - clampedDistance * 0.015 + RENDER_ORDER_OFFSET
    group.add(mesh)

    // 上下文行透明度基准（构建时值，逐帧 isActive 分支决定实际亮度）：
    // 上游 `stageLyricTrackBaseEntry` 对**每一行**都给
    // `clampRange(lyricContextOpacityValue(), 0.18, 0.92)` —— 与行距无关，
    // 距离衰减只在逐帧 `contextAlpha` 里做**一次**（`12-lyrics-row-layers.js:1465`）。
    // 此前构建时按距离减一次、逐帧再减一次，第 3 行起比上游暗一倍以上。
    const targetAlpha = Math.max(0.18, Math.min(0.92, CONTEXT_OPACITY))

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
      text: obsceneChar ? maskObsceneLine(line, obsceneMode, obsceneChar) : line.text,
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
  /**
   * 逐行辉光层（上游 `makeLyricRowGlowMesh`，12-lyrics-row-layers.js:309-348）。
   *
   * ★ 上游另有三层**整块**（非逐行）的静态发光层，本项目**有意未移植**：
   *
   *   · `data.sun`  / `sunMat`   太阳 bloom 面片（13-lyrics-mesh-build.js:96-111）
   *   · `data.glow` / `glowMat`  整块辉光面片（:112-130）
   *   · `data.sparks`/`sparkMat` 132 粒子火星（:131-200）
   *
   * 它们全部由 `suppressStaticGlow` 一票否决，而该标志是
   * `rowLayersActive`（13-lyrics-mesh-build.js:219）—— 即"逐行层已建成"。
   * 上游 `14-stage-lyrics-rendering.js` 对它们的处理是：
   *
   *   data.sun.visible = !data.suppressStaticGlow;      // :2337
   *   data.glow.visible = !data.suppressStaticGlow;     // :2330
   *   if (data.suppressStaticGlow) sunTarget = 0;       // :2441
   *   if (data.suppressStaticGlow) glowTarget = 0;      // :2425
   *   data.sunMat.opacity = (!data.suppressStaticGlow && …) ? … : 0;   // :2543
   *   data.glowMat.opacity = (!data.suppressStaticGlow && …) ? … : 0;  // :2537
   *
   * 出厂 `lyricDisplayMode: 'cinema'` 必然走逐行轨道
   * （`usesTrack === true` ⇒ `rowLayersActive`），因此这三层在出厂配置下
   * **恒不可见、恒零透明度** —— 与 [[mineradio-port-dead-code-paths]] 记的
   * `uLoading` / `shelfHoverCue` 同类：按上游原样保留（即不移植），
   * 不捏造上游在该配置下不画的发光。
   *
   * 其中 `sparks` 还额外被 `fx.lyricGlowParticles`（出厂 false）门控，
   * 双重不可达。
   *
   * 上游 420 粒子的**歌词星河流**（03-lyrics-star-river.js）同理：
   * 它的 opacity 链也由 `fx.lyricGlowParticles` 门控。本项目
   * `particles/StarRiver.tsx`（1400 粒子、六频段、uTintColor）是上游
   * **背景**星河流（00-pointer-cover-particles.js:1060-1100）的移植，
   * 与歌词星河流是两套东西，不要混淆。
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
      Math.max(lineTextWorldW + glowPad, lineTextWorldW * rowGlowTextureRatio, lineTextWorldW + glowPad * 0.62),
    )
    // 上游 rowGlowAspect：纹理真实宽高比（防止长行辉光变成过厚的扇贝带）
    const glowAspect = Math.max(0.001, glowCanvas.height / Math.max(1, glowCanvas.width))
    const glowWorldH = Math.min(lineWorldH * 1.36, Math.max(lineWorldH * 0.66, glowWorldW * glowAspect))

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
    glow.position.set(0, row.mesh.position.y, row.mesh.position.z - 0.03)
    glow.scale.copy(row.mesh.scale)
    glow.visible = false
    // 上游辉光 renderOrder（12-lyrics-row-layers.js:1716，逐帧重写）：
    //   主行   → renderBase − 0.52 = 42.48
    //   译词行 → renderBase − 0.02 = 42.98
    // 译词行的辉光排在**文字之上**（主行的排在文字之下）—— 译词更小更淡，
    // 让它的晕从字面上方漫出来才不会把父行的字压暗。
    // 此前两档共用 42.48，译词辉光被父行文字盖住一截。
    glow.renderOrder = (row.isTranslation ? 42.98 : 42.48) + RENDER_ORDER_OFFSET
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
    /** 本帧已推进的调色板补间结果（主行段算一次，全部行共用） */
    paletteTweened: { primary: THREE.Color; highlight: THREE.Color; secondary: THREE.Color },
    /**
     * 换行后的上下文淡入包络（上游 `contextIntro`，:2362）。
     * 主行段算一次，全部行共用 —— 译词行同样受它管
     * （`rowIntro = motionAnchor ? 1 : contextIntro`，:1520）。
     */
    contextIntroForRow: number,
    /** 本帧故障脉冲（上游 `glitchPulse`，主行段算一次，全部行共用） */
    glitchPulse: number,
  ) => {
    const group = groupRef.current
    const rows = rowsRef.current
    if (!group) return
    const frameScale = Math.min(3, Math.max(0.25, dt * 60))
    // baseEase 由 contextIntro 决定（上游 :2413）：淡入期间 0.19、稳定后 0.135。
    const rowEaseBase = contextIntroForRow < 0.98 ? 0.19 : 0.135
    const ease = 1 - Math.pow(1 - rowEaseBase, frameScale)

    let row = rows[slotIndex]
    if (!row) {
      if (!windowActive) return
      // 译词字号：当前父行 0.702、上下文 0.598（上游 :2698 的两档）
      const raster = rasterizeLyricLineMask({
        text,
        scale: isCurrentParent ? TRANS_CURRENT_FONT_SCALE : TRANS_CONTEXT_FONT_SCALE,
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
      mesh.scale.setScalar(lyricShelfAvoidScale())
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
    // 译词槽位 = 父行槽位 + visualGap ⇒ 父行距就是 `transDelta − TRANS_GAP`；
    // `|parentDelta|` 是译词行**唯一**的距离量（深度淡出 / z / 缩放 / 揭示车道）。
    // 推导与"sign 恒为 +1"的完整说明见本段下方的长注释。
    const parentDelta = transDelta - TRANS_GAP
    const parentAbsT = Math.abs(parentDelta)
    // 揭示调度（上游 :1528）：锚定行（当前译词）立即揭示；上下文译词行按
    // 车道延迟 `10 + lane×14`，且译词行再 `+8`（同一条公式的 translation 项，
    // 用来掩盖译词纹理的上传耗时）。此前译词行无调度，进窗即显示。
    if (windowActive && !row.windowActive) {
      row.windowActive = true
      row.revealAt = isCurrentParent
        ? nowMs
        : nowMs + REVEAL_BASE_MS + Math.min(5, Math.round(parentAbsT)) * REVEAL_LANE_MS + 8
    } else if (!windowActive && row.windowActive) {
      row.windowActive = false
      row.revealAt = 0
    }
    const revealOk = windowActive && nowMs >= row.revealAt
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

    // 上游 12-lyrics-row-layers.js:63：
    //   lineY = -parentDelta × lineStepWorld − sign × visualGap × translationLineStepWorld
    // `transDelta` 已是 `subs[k] - scroll`（= 槽位空间的父行距 + 译词偏移），
    // 因此不能整个乘主行步长 —— 只有**父行那一段**用宽步长，
    // "主行→译词"这一段用窄步长 `LYRIC_TRANSLATION_STEP_WORLD`。
    //
    // ★ `sign` 恒为 +1，不能按 `transDelta` 的符号取（这是曾经的缺陷）：
    //   上游 track 分支判的是 `rowVirtual >= parentVirtual`（:74），而译词
    //   虚拟槽位恒等于 `父行 + visualGap`（gap ≥ 0.92 > 0），所以永远是 +1；
    //   non-track 分支的 `localSign`（:60）判的也是同一个"译词在父行下方"的
    //   事实，只是在单行模式下 gap 不会被滚动抵成负数。
    //   本项目此前照搬 non-track 的 `localSign = transDelta >= 0 ? 1 : -1`，
    //   于是**已经唱过的那一行**（父行在滚动位上方）`transDelta = 父行距 + gap`
    //   会变成负数，符号翻成 −1 并连带把 `parentDelta` 推远 2×TRANS_GAP：
    //     · 译词与自己的主歌词间距 0.799 world（应为 0.480，宽 66%）
    //     · 漂移增益按错误的 |parentDelta| 取值
    //   视觉上就是"未激活的主歌词和它的翻译行离得太开"。激活行与后续行
    //   transDelta 本就为正，所以只有**滚过去的行**看得出问题。
    // ★ 距离按**父行**算（上游 :1496-1501 在 track 分支把 `visibilityAbs`
    //   覆写成 `|parentVirtual − scroll|`）：译词只是父行下方的一小段偏移，
    //   不该按自己的槽位（父行 + gap）再往外沉。此前用译词自身槽位，
    //   激活行的译词比上游深、小、暗一档。
    const clampedDelta = Math.min(ROW_MAX_DELTA, parentAbsT)
    const zTarget = ROW_Z_BASE - Math.pow(clampedDelta, ROW_Z_POW) * ROW_Z_GAIN
    // ★ 上游 `lyricTranslationAnchoredY`（12-lyrics-row-layers.js:51-73）的
    //   译词 Y 与主行不同 —— 它按**父行**的距离算漂移，且当前译词行不漂：
    //
    //     parentDrift = currentTranslation ? 0
    //                 : rowDrift × clampRange(0.70 + |parentDelta|×0.10, 0.65, 1.20)
    //     return −parentDelta × lineStepWorld + parentDrift
    //            − sign × visualGap × translationLineStepWorld
    //
    //   本项目走的是上游的 **track 分支**（常驻轨道覆盖整首歌），见上。
    // ★ `rowDrift` 的 `contextDrift` 输入同样是风格基值 + |lineStepWorld|×0.030
    //   （上游 14-stage-lyrics-rendering.js:2396）。
    const transRowDrift = isCurrentParent
      ? 0
      : (0.5 - shownProgressRef.current) * (motion.contextDrift + Math.abs(LYRIC_LINE_STEP_WORLD) * 0.03)
    const transDriftGain = Math.max(0.65, Math.min(1.2, 0.7 + Math.abs(parentDelta) * 0.1))
    // ★ 上游行层**没有**逐行 Y 方向的正弦浮动（`rowYTarget = yTarget + jitterY`，
    //   而 `jitterY` 只在故障风格下由 `glitchPulse` 生成，其余恒 0）。
    //   本项目的 `sin(t×0.68 + slot×0.71) × 0.008` 是把上游**缩放**浮动的相位
    //   误抄到了 Y 上（缩放那一项在下面 `floatScaleWobble` 里才是对的），已删。
    const yTarget =
      -parentDelta * LYRIC_LINE_STEP_WORLD -
      TRANS_GAP * LYRIC_TRANSLATION_STEP_WORLD +
      transRowDrift * transDriftGain
    const depthScale = Math.max(ROW_SCALE_MIN, 1 - clampedDelta * ROW_SCALE_FALLOFF)
    const fitRatio = lyricRowFitRatio(mesh, row.raster, size.width, camera)
    // 上游 :1616-1618 的译词缩放链：
    //   baseScale *= 1.00 + translationFocus × 0.16
    // （`singleLineTranslationSwap` 是 single 模式专用，本项目逐行架构不涉及）
    // 再乘 :1626 的逐行缩放浮动（与主行同源同相位；译词行恒非锚定，
    // 所以这项对译词行**总是**生效）。
    // ★ 上游 :1626 `scaleTarget = baseScale × (motionAnchor || !verticalFloatOn ? 1 : …)`
    //   —— 当前译词行是 motionAnchor，**不参与**这项抖动。
    const floatScaleWobble =
      isCurrentParent
        ? 1
        : 1 + Math.sin((nowMs / 1000) * 0.68 + slot * 0.71) * (motionStyle === 'float' ? 0.012 : 0.004)
    const scaleTarget =
      depthScale * lyricShelfAvoidScale() * (1 + parentFade * 0.16) * fitRatio * floatScaleWobble

    // 上游 :1606/1640 的译词两项 z / renderOrder 修正：
    //   zTarget = zBase − (motionAnchor ? 0 : |rowDrift|×0.18)
    //             + translationFocus × 0.065
    //   renderOrder = renderBase + 0.05 + (currentTranslation ? 0.34 : focus×0.30)
    // 两者都由 parentFade 驱动 —— 父行越近，译词越被"提到前面来"，
    // 既在深度上也在绘制次序上贴近父行。
    mesh.renderOrder = 43.05 + (isCurrentParent ? 0.34 : parentFade * 0.3) + RENDER_ORDER_OFFSET
    const zTargetWithFocus = zTarget - Math.abs(transRowDrift) * 0.18 + parentFade * 0.065

    mesh.position.y += (yTarget - mesh.position.y) * ease
    mesh.position.z += (zTargetWithFocus - mesh.position.z) * ease
    const s = mesh.scale.x + (scaleTarget - mesh.scale.x) * ease
    mesh.scale.setScalar(s)
    // 行级 rot.z 摆动（上游 :2487 的 `rootRotationTarget`，ease 0.18）。
    mesh.rotation.z += (rowRootRotationRef.current - mesh.rotation.z) * 0.18

    const uniforms = row.material.uniforms
    uniforms.uTime.value += dt
    // 译词行永不激活：uActiveMix → 0（无逐字/扫光/节拍泛光）
    // ★ 残值地板（上游 :1661-1662，主行同款）：指数缓动永远到不了 0，
    //   < 0.015 直接置 0 —— 否则译词行长期残留一丝"激活态"逐字填充。
    // 故障脉冲（上游 :1663）：译词行恒非激活 ⇒ 取 `glitchPulse × 0.35`。
    const transBurstTarget = glitchPulse * 0.35
    uniforms.uGlitchBurst.value +=
      (transBurstTarget - (uniforms.uGlitchBurst.value as number)) * 0.25
    // 非激活行的 uActiveMix 回落速率（上游 :1658 的 `isActive ? 0.34 : 0.62`）
    uniforms.uActiveMix.value += (0 - (uniforms.uActiveMix.value as number)) * 0.62
    if ((uniforms.uActiveMix.value as number) < 0.015) uniforms.uActiveMix.value = 0
    // 透明度（上游 :1522 / :1597 / :1644 / :1665）：
    //   target    = opacity × contextAlpha × rowIntro × visibleFade
    //   depthFade = motionAnchor ? 1 : clamp(1 − |Δ|×0.055, 0.54, 1) × visibleFade
    //   行透明度  = target × depthFade
    //
    // ★ `motionAnchor = isActive || currentTranslation`（:1519）—— 译词行永不
    //   isActive，因此只有**当前译词行**豁免淡入包络与可见淡出（visibleFade
    //   恒 1）；其余译词行随换行整体淡入。
    // ★ `visibleFade` 在 target 与 depthFade 里各出现一次（上游原文如此），
    //   窗口边缘的行因此按平方衰减。此前本项目只乘一次，边缘行偏亮。
    const visibleFadeRaw = Math.max(
      0,
      Math.min(1, (visibleRadiusForTrans() + 1.1 - parentAbsT) / 1.1),
    )
    const visibleFade = isCurrentParent ? 1 : smoothstep(visibleFadeRaw)
    const depthFade = isCurrentParent
      ? 1
      : Math.max(0.54, 1 - Math.min(ROW_MAX_DELTA, parentAbsT) * 0.055) * visibleFade
    const rowIntro = isCurrentParent ? 1 : contextIntroForRow
    const opacityTarget = CURRENT_LINE_OPACITY * targetAlpha * rowIntro * visibleFade * depthFade
    uniforms.uOpacity.value += (opacityTarget - (uniforms.uOpacity.value as number)) * ease

    // 配色：与主行同一份补间（上游 `applyLyricPaletteToMesh` 遍历 current +
    // outgoing 全部 mesh）。补间状态是模块级单例，同一帧内多次调用会重复
    // 推进 `elapsed` —— 因此这里用**本次帧已算好的结果**（由主行段传入），
    // 而不是再调一次 `stepLyricPalette`。
    ;(uniforms.uBaseColor.value as THREE.Color).copy(paletteTweened.primary)
    ;(uniforms.uHiColor.value as THREE.Color).copy(paletteTweened.highlight)
    ;(uniforms.uGlowColor.value as THREE.Color).copy(paletteTweened.secondary)
    ;(uniforms.uSolarColor.value as THREE.Color).copy(paletteTweened.highlight)

    // 可读性层：译词 mix 0.46 + focus×0.18（上游 :1685），
    // backdropAdapt 亮底避光把 mix 抬到 max(mix, 0.54 + adapt×0.10)，
    // 整体 boost ×(1 + adapt×0.66)（上游 :1684-1691）。
    if (!row.readability) ensureRowReadability(row)
    if (row.readability && row.readabilityMaterial) {
      row.readability.position.y = mesh.position.y
      row.readability.position.z = mesh.position.z - 0.012
      row.readability.scale.copy(mesh.scale)
      // ★ renderOrder 每帧跟随主网格（上游 :1680 的 `- 0.04`）——
      //   建行时写的 `- 0.05`（:550）只是初值，逐帧那一行会覆盖它。
      //   此前本项目只保留了初值，于是可读性层恒比上游低 0.01：
      //   主行 renderOrder 是 `42.6 − dist×0.015`（逐行递变），
      //   相邻两行的可读性层与文字层的**相对次序**会差半个身位。
      row.readability.renderOrder = mesh.renderOrder - 0.04
      const transMix = Math.max(0.46 + parentFade * 0.18, 0.54 + BACKDROP_ADAPT * 0.1)
      const transBoost = 1 + BACKDROP_ADAPT * 0.66
      const target = opacityTarget * 0.86 * transMix * transBoost
      row.readabilityMaterial.opacity += (Math.min(1, target) - row.readabilityMaterial.opacity) * ease
      row.readabilityMaterial.color.set('#ffffff').lerp(readabilityDarkColor, Math.min(0.92, BACKDROP_ADAPT * 0.92))
    }
    // 译词辉光（上游 translation 辉光分支 :1721）：
    //   当前父行 → target × rowGlow × (0.46 + rowGlowBeat×0.08)
    //   非当前   → target × rowGlow × (0.30 + rowGlowBeat×0.06) × translationGlowFocus
    // 两者都要再乘 backdropAdapt 压暗项（1 − adapt×0.30，上游 :1722）。
    if (!row.glow) ensureRowGlow(row)
    if (row.glow && row.glowMaterial) {
      row.glow.position.copy(mesh.position)
      row.glow.position.z = mesh.position.z - 0.03
      row.glow.scale.copy(mesh.scale)
      // 译词辉光排在文字之上（上游 :1716 每帧重写 renderBase − 0.02）
      row.glow.renderOrder = 42.98 + RENDER_ORDER_OFFSET
      row.glowMaterial.color.set(glowColorForPalette(colorsRef.current))
      const rowGlowBeat = Math.max(0, Math.min(1.5, glowStateRef.current.beatGlow))
      const backdropAdaptDim = 1 - BACKDROP_ADAPT * 0.3
      // ★ 上游 :1721 的基准是 `target`（= opacity × contextAlpha × rowIntro ×
      //   visibleFade），不是条目的上下文 α；`translationFocus` 只乘在
      //   非当前支上（当前支的 0.46 已经是"焦点满"的系数，再乘 parentFade
      //   等于把焦点平方）。
      const glowBase = CURRENT_LINE_OPACITY * targetAlpha * rowIntro * visibleFade
      const glowOpacityTarget = isCurrentParent
        ? glowBase * currentLineGlow * (0.46 + rowGlowBeat * 0.08) * depthFade * backdropAdaptDim
        : glowBase * currentLineGlow * (0.3 + rowGlowBeat * 0.06) * parentFade * depthFade * backdropAdaptDim
      const g = row.glowMaterial.opacity
      let nextGlow = g + (glowOpacityTarget - g) * (glowOpacityTarget > g ? GLOW_RISE : GLOW_FALL)
      if (nextGlow < GLOW_ZERO) nextGlow = 0
      row.glowMaterial.opacity = nextGlow
    }
  }

  /** 译词行可见半径（主行同款公式；独立函数避免每帧闭包差异）。 */
  const visibleRadiusForTrans = () =>
    Math.max(0.85, stackLines * 0.5 * (effectiveTranslationMode !== 'off' ? SLOT_WITH_TRANS : 1))

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
    rowsRef.current = new Array(stageLines.length + slotInfo.transSlot.reduce((n, t) => n + (t?.length ?? 0), 0)).fill(
      null,
    )
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
    // signature 覆盖全部行内容、遮罩字符与外观设置。
    // ★ **不含视口尺寸**：逐行 fit 是逐帧算的，resize 不需要重建
    //   （见上方 `viewportKey` 移除处的说明）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // ---------------------------------------------------------------- 每帧驱动
  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    const rows = rowsRef.current
    const runtime = runtimeRef.current
    const { stageLines: lines } = runtime
    const dt = Math.min(delta, 1 / 20)
    const nowMs = performance.now()

    // ★ 逐帧时钟优先（见 `lyricPlayerBridge.getFrameTime` 说明）。
    //
    //   store 的 `currentTime` 被 `useHowl` 按 100ms 节流（10Hz），逐字填充
    //   会按 ~100ms 离散跳变、激活行切换最多滞后 100ms；而 AMLL 走每帧
    //   `setCurrentTime`。同一首歌切到经典播放器就变顺滑 —— 是肉眼可见的
    //   不一致。这里读同一份逐帧值；取不到时（尚未起播 / 已停止）回退到
    //   构建时算好的 store 值，行为与之前一致。
    const frameTime = lyricPlayerBridge.getFrameTime()
    const now = frameTime === null ? runtime.nowSeconds : Math.max(0, frameTime - offsetMs / 1000)
    // 激活行随之逐帧重判（原来只在 store 更新时随 useMemo 重算）
    const active = frameTime === null ? runtime.activeIndex : findActiveLineIndex(lines, now)

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
    // 组级 `enterDirection` 的输入（上游 `lineStep > 0 ? -1 : 1`）。
    // 只在滚动真正发生时更新方向，静止时保留上次方向 —— 否则 `needsSnap`
    // 那种零增量帧会把方向冲掉，换行瞬间的滑入方向随机。
    if (Math.abs(newScroll - scroll) > 1e-6) {
      trackVelocityRef.current = newScroll - scroll
    }
    // 换行 ⇒ 组级包络重新计时（上游 `userData.age = 0`）。
    // 用**激活行索引**判换行，不用滚动量：滚到一半时行没变，包络不该重来。
    if (runtimeRef.current.activeIndex !== lastActiveIndexRef.current) {
      lastActiveIndexRef.current = runtimeRef.current.activeIndex
      groupAgeRef.current = 0
    }
    groupAgeRef.current += dt

    // ★ `contextIntro` —— 换行后**上下文行**的整体淡入包络
    //   （上游 14-stage-lyrics-rendering.js:2362-2363）：
    //
    //     contextIntro = clampRange((age - 0.04) / 0.48, 0, 1)
    //     contextIntro = smoothstep(contextIntro)
    //
    //   它有两条去向，本项目此前**两条都缺**：
    //
    //   a. 喂进 `updateLyricRowLayers` 的 `contextIntro`（:2394），在
    //      `12-lyrics-row-layers.js:1329/1520` 变成 `rowIntro`：
    //        rowIntro = motionAnchor ? 1 : contextIntro
    //        target   = opacity × (isActive ? 1 : contextAlpha) × rowIntro × visibleFade
    //      即换行后**非锚定行**（非激活、非当前译词）从 0 淡入，用 0.04s 延迟
    //      + 0.48s 包络。缺它时上下文行在换行瞬间就是满亮度，没有"新的一屏
    //      上下文渐渐浮出来"的层次 —— 激活行有滑入包络（groupASmooth），
    //      上下文行却是硬切。
    //
    //   b. 决定行层的 `baseEase`（:2413）：
    //        ease = contextIntro < 0.98 ? 0.19 : 0.135
    //      即**淡入期间位置/缩放追得更快**（0.19），稳定后放慢到 0.135。
    //      本项目两处行层都把 baseEase 写死成 0.16 —— 既不是淡入档也不是
    //      稳定档，换行时跟得偏慢、稳定后又偏快。
    //
    //   ★ 这里**不含**上游 :2379 的 `contextY` / :2380 的 `contextScale` ——
    //     那两项写的是 `data.context`（旧版聚合上下文网格）。它在
    //     `13-lyrics-mesh-build.js:77-78` 声明后**从未被赋值**，
    //     `data.contextMat` 恒为 null，整个 `if (data.contextMat)` 块
    //     （:2366-2388）在行层架构下是死代码 —— 与 sun/glow/sparks 同类
    //     （那三个由 `suppressStaticGlow = rowLayersActive` 关掉，
    //     见 `ensureRowGlow` 处的说明）。逐行架构里这两项的等价物就是
    //     已移植的逐行 `rowDrift` 与 `floatScaleWobble`。
    const contextIntroRaw = Math.max(0, Math.min(1, (groupAgeRef.current - 0.04) / 0.48))
    const contextIntro = smoothstep(contextIntroRaw)
    // 上游 :2413 的两档 baseEase
    const rowBaseEase = contextIntro < 0.98 ? 0.19 : 0.135

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
        (0.18 + glowBreath * 0.16 + musicBloom * 0.9 + glow.beatGlow * 1.18 + Math.sin(t * 0.37 + 1.2) * 0.035) *
          GLOW_DRIVE,
      ),
    )
    glow.highBloom += (solarBloom - glow.highBloom) * (solarBloom > glow.highBloom ? 0.075 : 0.05)
    // 本帧故障脉冲（上游 `glitchPulse`，`12-lyrics-row-layers.js:1663` 的输入）。
    // 上游只在 `style === 'glitch'` 时非零（`glitchAmount > 0`，14-stage:2253），
    // 由主循环从音频与节拍相机推导；本项目沿用既有 `bands.bassHit`
    // 作为同源触发。它同时喂主行与译词行的 `uGlitchBurst`。
    const glitchPulse = m.glitch > 0 && bands.bassHit ? 1 : 0
    // 4) 当前行辉光强度（上游 :2388-2391）：cap 1.05。
    const glowLift = GLOW_LIFT[motionStyle] ?? 1
    const currentLineGlow = Math.min(
      1.05,
      (0.1 + glow.highBloom * 0.4 + glow.beatGlow * 0.24 + bands.beat * 0.08) * Math.min(2.4, GLOW_DRIVE) * glowLift,
    )
    // 5) 调色板补间（上游 setStageLyricPalette 的 520ms）—— **必须在行循环
    //    之前**推进一次，供本帧所有行共用（补间状态是模块级单例，
    //    每多调一次就多推进一帧）。
    const paletteTweened = stepLyricPalette(dt, {
      primary: colorsRef.current.primary,
      highlight: colorsRef.current.highlight,
      secondary: colorsRef.current.secondary,
    })

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
    // ★ 辉光色每帧**算一次**，不在行循环里逐行算（第三十四轮性能修复，§5.4 D5）。
    //   `glowColorForPalette` 内部跑正则 `/^#?([0-9a-f]{6})$/i.exec` 加三次
    //   `toString(16).padStart` —— 而调色板在两次换封面之间是**常量**。
    //   此前它在行循环里被调用（每行每帧），行多时纯属浪费。
    const glowColor = glowColorForPalette(palette)

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const slot = slotInfo.slotStart[lineIndex] ?? lineIndex
      const liveDelta = slot - newScroll
      const absDelta = Math.abs(liveDelta)
      const isActive = lineIndex === active

      // ---- 译词独立行（上游 translationLine：独立网格 + 虚拟槽位）----
      // 译词行跟随父行的推进推进自己的位置/揭示/透明度链；dual 模式下
      // 只有当前行与下一行有译词（上游 :1483-1487）。
      const subs = slotInfo.transSlot[lineIndex]
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
      // ★ 窗口外且**一行都没建**时整块跳过（第三十四轮性能修复，§5.4 D2）。
      //
      //   此前无条件走下面的 `translationSubEntries`（**每行每帧新建一个数组**）
      //   与 `transAlpha` 闭包 —— 120 行的歌就是 7200 个数组/秒，而其中绝大多数
      //   是离屏几百槽位、连行都还没建的行。
      //
      //   ★ 判据必须是"**该行的译词行一个都没建**"而不是"窗口外"：
      //     窗口外但**已建**的行仍需逐帧推进（把 opacity 衰到 0、维持位置），
      //     跳过会让它冻结在上一次的值。
      //     `subs &&` 保留在此处（不是靠标志位）以便 TS 收窄类型。
      let transRowBuilt = false
      if (subs) {
        if (transWindowActive) {
          transRowBuilt = true
        } else {
          const base = lines.length + (slotInfo.transOffset[lineIndex] ?? 0)
          for (let k = 0; k < subs.length; k++) {
            if (rows[base + k]) {
              transRowBuilt = true
              break
            }
          }
        }
      }
      if (subs && transRowBuilt) {
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
          // current / dual：clampRange(currentOpacity × parentFade, 0, currentOpacity)
          // ★ 下界是 **0**，不是 0.08 —— 这两个模式只允许当前行（dual 再放
          //   下一行）的译词可见，parentFade = 0 的远处译词必须**完全不可见**。
          return Math.max(0, Math.min(TRANS_CURRENT_ALPHA, TRANS_CURRENT_ALPHA * parentFade))
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
        // （`lineOffset` / `transWindowActive` 已在块外算好，此处复用。）
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
            paletteTweened,
            contextIntro,
            glitchPulse,
          )
        }
      }

      // ---- 常驻轨道懒建（上游 trackPersistent + ensureStageLyricPersistentTrackRows）----
      // 行接近窗口（可见半径 + 预建余量）时补建；栅格化失败的行不再重试
      let row = rows[lineIndex]
      if (!row) {
        // ★ `absDelta` 是**槽位**空间的距离（`liveDelta = slot - newScroll`），
        //   用于判断"这一行是否接近可见窗口" —— 这是对的，保持不变。
        if (absDelta > visibleRadius + PREBUILD_MARGIN || failedRowsRef.current.has(lineIndex)) continue
        // ★ 但 `buildRow` 的第二个参数是**行号**（内部算 `|lineIndex - anchor|`
        //   来决定上下文缩放、`targetAlpha` 与 `builtAsActive`），
        //   曾经错传 `Math.round(newScroll)`（**槽位**值）。
        //
        //   有译词的歌里 `slotStart[i] ≈ 2.1214·i`，于是第 20 行会拿到
        //   `anchor≈42`、`distance≈22`：`targetAlpha` 被压到地板 0.16
        //   （而非 0.54），而它同时喂给**激活行的辉光** → 懒建出来的行
        //   上下文偏暗、激活行辉光弱约 3.4×。无译词的歌 `slotStart[i] === i`，
        //   所以手工抽查会漏掉。
        //
        //   锚点语义与初始建行一致（那里传的是 `activeIndex`）：
        //   即"当前激活行"本身。首行之前 `activeIndex` 为 -1，回退到 0。
        row = buildRow(lineIndex, active >= 0 ? active : 0)
        if (!row) {
          failedRowsRef.current.add(lineIndex)
          continue
        }
      }

      // ---- 揭示编排（上游 :1524-1545）----
      // 行进入窗口（|liveDelta| ≤ 可见半径 + 1.1）时排一个揭示时刻
      const visibleFadeRaw = Math.max(0, Math.min(1, (visibleRadius + 1.1 - absDelta) / 1.1))
      // 上游 :1522 `visibleFade = motionAnchor ? 1 : smoothstep(…)` —— 激活行恒 1，
      // 即便滚动尚未收敛到该行。此前一律按距离算，切行瞬间激活行会先暗一下。
      const visibleFade = isActive ? 1 : smoothstep(visibleFadeRaw)
      const renderWindowActive = visibleFade > 0.002 || isActive
      if (renderWindowActive && !row.windowActive) {
        row.windowActive = true
        // 上游 :1528：`motionAnchor || uploaded ? 0 : 10 + lane×14`
        // —— 激活行立即揭示，只有上下文行按车道延迟（掩盖纹理上传）。
        row.revealAt = isActive
          ? nowMs
          : nowMs + REVEAL_BASE_MS + Math.min(5, Math.round(absDelta)) * REVEAL_LANE_MS
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
      // ★ 逐行 Y 方向**没有**正弦浮动：上游 `rowYTarget = yTarget + jitterY`，
      //   而 `jitterY` 只在故障风格、`glitchPulse > 0` 时非零（14-stage:2296）。
      //   此前的 `sin(t×0.68 + index×0.71) × 0.008` 是把**缩放**浮动的相位
      //   误抄到了 Y 上（`floatPhase` 仍供下面的 `floatScaleWobble` 使用）。
      const floatPhase = t * 0.68 + lineIndex * 0.71
      // ★ 上下文行的**进度漂移**（上游 :1599 的 `rowDrift` 项）：
      //
      //   rowDrift = (0.5 − shownProgress) × contextDrift × motionBlend
      //   yTarget  = −liveDelta × lineStepWorld
      //            + (motionAnchor ? 0 : rowDrift × clampRange(0.70 + |Δ|×0.10, 0.65, 1.20))
      //
      // `motionAnchor = isActive || currentTranslation`（:1519），所以激活行
      // 与当前译词行不参与漂移，其余行随**当前行的逐字进度**整体上下移动：
      // 进度 0 时 +contextDrift/2、进度 1 时 −contextDrift/2、过半时归零。
      // 出厂风格 `float` 的 contextDrift = 0.120，|Δ| = 1 的行上给出
      // ±0.048 世界单位的位移 —— 肉眼可见的"上下文随当前句一起呼吸"。
      //
      // ★ `contextDrift` 输入是**风格基值 + |lineStepWorld| × 0.030**
      //   （上游 14-stage-lyrics-rendering.js:2396），表里只放风格基值，
      //   这里补步长那一项（本项目在调用处补，与上游同源）。
      // ★ `motionBlend`（预览混合系数）本项目没有预览锁定，恒取 1。
      // ★ z 上还有一项 `− |rowDrift| × 0.18`（:1606，motionAnchor 时 0）——
      //   漂移幅度越大行被压得越远，一并补上。
      const rowDrift = isActive
        ? 0
        : (0.5 - shownProgressRef.current) *
          (motion.contextDrift + Math.abs(LYRIC_LINE_STEP_WORLD) * 0.03)
      const driftGain = Math.max(0.65, Math.min(1.2, 0.7 + absDelta * 0.1))
      const yTarget = -liveDelta * LYRIC_LINE_STEP_WORLD + rowDrift * driftGain
      const zTargetWithDrift = zTarget - Math.abs(rowDrift) * 0.18

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
        // ★ 逐行**缩放**浮动（上游 :1626，`fx.lyricVerticalFloat` 出厂 true）：
        //
        //   scaleTarget = baseScale × (motionAnchor || !verticalFloatOn ? 1
        //     : (1 + sin(t*0.68 + seed + stableMotionIndex*0.71)
        //           × (style==='float' ? 0.012 : 0.004) × motionBlend))
        //
        // 即**非锚定行**（上下文行）的缩放按各自错相的相位轻微呼吸；
        // 激活行是 motionAnchor，恒不抖。★ 上游的行 Y 没有对应项
        // （`rowYTarget = yTarget + jitterY`，jitterY 只由故障脉冲生成）。
        // ★ `motionBlend` 本项目恒取 1（无预览锁定）。
        const floatScaleWobble =
          isActive ? 1 : 1 + Math.sin(floatPhase) * (motionStyle === 'float' ? 0.012 : 0.004)
        const scaleTarget = depthScale * lyricShelfAvoidScale() * fitRatio * floatScaleWobble

        // baseEase 由 contextIntro 决定（上游 :2413），不再写死 0.16
        const ease = 1 - Math.pow(1 - rowBaseEase, Math.min(3, Math.max(0.25, dt * 60)))
        // ★ 主行 renderOrder **每帧重写**（上游 :1640）：
        //   isActive ? (renderBase + 0.40) : (renderBase − 0.40 − min(5.5,|Δ|)×0.015)
        // 即激活行 43.4、上下文行 42.6 − |Δ|×0.015（未乘 RENDER_ORDER_OFFSET 的裸值）。
        //
        //   ★ 此前只在 buildRow 与 rebuildRowAsActive 里各写一次，于是
        //     `rebuildRowAsActive` 把 renderOrder 提到 43.4 之后**再也没有人
        //     把它放回去** —— 任何"曾经激活过"的行都永久停在 43.4，
        //     压在所有上下文行（乃至后来的激活行）之上。
        //     视觉后果：唱过去的句子盖在正在唱的那句前面。
        mesh.renderOrder = (isActive ? 43.4 : 42.6 - Math.min(ROW_MAX_DELTA, clampedDelta) * 0.015) + RENDER_ORDER_OFFSET
        mesh.position.y += (yTarget - mesh.position.y) * ease
        mesh.position.z += (zTargetWithDrift - mesh.position.z) * ease
        const s = mesh.scale.x + (scaleTarget - mesh.scale.x) * ease
        mesh.scale.setScalar(s)
        // 行级 rot.z 摆动（上游 :2487，见 stepRow 处的同款说明）
        mesh.rotation.z += (rowRootRotationRef.current - mesh.rotation.z) * 0.18

        // 材质
        const uniforms = row.material.uniforms
        uniforms.uTime.value += dt
        // ★ 激活门控逐帧重判（上游 isActive = rowLineIndex === presentationLineIndex）：
        //   逐字进度、节拍泛光、故障只属于当前激活行；行一旦失活立即回落 ——
        //   此前这些状态被冻结在构建时刻，"激活行高亮不消失"的逐帧侧根因。
        uniforms.uActiveMix.value +=
          ((isActive ? 1 : 0) - (uniforms.uActiveMix.value as number)) * (isActive ? 0.34 : 0.62)
        // ★ 残值地板（上游 :1661/:1665-1667）：
        //   非激活行 uActiveMix < 0.015 直接置 0、uSolar < 0.003 直接置 0。
        //   指数缓动永远到不了 0，少了这一步会残留一个极小但非零的值 ——
        //   而 uActiveMix 驱动逐字填充与扫光，uSolar 驱动太阳泛光，
        //   残留量让"失活行"仍带一丝激活态着色，且永不消失。
        if (!isActive && (uniforms.uActiveMix.value as number) < 0.015) {
          uniforms.uActiveMix.value = 0
        }
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
          // 组级 `progressLift` 的输入（上游 `shownProgress`，:2484）——
          // 必须是**已显示**的进度（缓动后的值），不是目标值：否则文字会在
          // 行首/行尾之间反复跳沉。上游同源取 `data.shownLyricProgress`。
          shownProgressRef.current = uniforms.uProgress.value as number
          // uSolar 驱动源对齐上游（14-stage-lyrics-rendering.js:2414-2418）：
          // 激活行的 uSolar 跟随 highBloom（副歌持续泛光），ease 0.12 ——
          // 此前跟 bands.beat（逐拍闪烁），观感节奏与上游不同。
          const solarTarget = glow.highBloom
          uniforms.uSolar.value += (solarTarget - (uniforms.uSolar.value as number)) * 0.12
        } else {
          uniforms.uProgress.value = 0
          uniforms.uSolar.value += (0 - (uniforms.uSolar.value as number)) * 0.48
          // 残值地板（上游 :1666-1667）
          if ((uniforms.uSolar.value as number) < 0.003) uniforms.uSolar.value = 0
        }

        // ★ 故障脉冲必须对**每一行、每一帧**更新（上游 `12-lyrics-row-layers.js:1663`）：
        //
        //     uGlitchBurst = isActive ? glitchPulse : glitchPulse * 0.35
        //
        //   注意上游那行**没有** isActive 守卫 —— 所有行都写，非激活行取 0.35 倍。
        //   此前本项目把它写在 `if (isActive)` 里，于是**激活过的行失活后
        //   uGlitchBurst 冻结在最后一次的峰值**（可到 ~1.0），而它驱动
        //   `glitchWidth ×(0.55 + 1.85·burst)` 与 `glitchGate +0.28·burst` ——
        //   表现为"非激活行比激活行闪得更凶"，且永不消退（故障风格下最明显）。
        //   放在 if/else 之外即同时修好"冻结"与"非激活行更强"两个症状。
        const burstTarget = glitchPulse * (isActive ? 1 : 0.35)
        uniforms.uGlitchBurst.value += (burstTarget - (uniforms.uGlitchBurst.value as number)) * 0.25

        // 透明度（上游 :1465 + :1660）：
        //   上下文 alpha 链 = target × (1 − max(0,|Δ|−0.25)×0.070)，夹 [0.16, 0.92]
        //   —— 逐帧按 liveDelta 计算，行离开激活位后自然回落到上下文亮度。
        //   再乘距离淡出 × 揭示淡入。
        // ★ 显示模式门控（上游 12-lyrics-row-layers.js:1505-1517）：不在该模式的
        //   偏移集内 → contextAlpha 归零，整行不显示。半径只管"建不建行"。
        const modeAllowed = isActive || allowedOffsets.has(roundToLineOffset(lineIndex - active))
        // 上游 :1464-1465（`targetAbs` = 到**激活行**的距离，不是到滚动位）：
        //   clampRange(targetAlpha × (1 − max(0, targetAbs − 0.25) × 0.070), 0.16, 0.92)
        // 是**乘法**衰减，不是从 targetAlpha 里减 —— 两者在 |Δ|=3 处差一倍
        // （乘法 0.43 / 减法 0.35），第 5 行起差得更多。
        const targetAbs = Math.abs(slot - target)
        const contextAlpha = !modeAllowed
          ? 0
          : isActive
            ? 1
            : Math.max(
                CONTEXT_ALPHA_MIN,
                Math.min(0.92, row.targetAlpha * (1 - Math.max(0, targetAbs - 0.25) * CONTEXT_ALPHA_FALLOFF)),
              )
        const depthFade = isActive ? 1 : Math.max(0.54, 1 - clampedDelta * 0.055) * visibleFade
        // ★ `rowIntro`（上游 :1597 的 `(isActive ? 1 : contextAlpha) * rowIntro`
        //   与 :1520 的 `rowIntro = motionAnchor ? 1 : contextIntro`）：
        //   换行后非锚定行整体淡入。激活行（与当前译词行）不受影响。
        const rowIntro = isActive ? 1 : contextIntro
        // 上游 :1597：target = opacity × (isActive ? 1 : contextAlpha) × rowIntro × visibleFade
        // 其中 opacity 是全局 0.96（shelfDetailLyricProfile.opacity），depthFade 单独再乘。
        const targetOpacity = CURRENT_LINE_OPACITY * contextAlpha * rowIntro * visibleFade
        const opacityTarget = targetOpacity * depthFade
        uniforms.uOpacity.value += (opacityTarget - (uniforms.uOpacity.value as number)) * ease

        // 配色：用帧首推进好的补间结果（见上方"5) 调色板补间"）。
        // 这里**不得**再调 `stepLyricPalette` —— 补间状态是模块级单例，
        // 重复调用会让同一帧的 `elapsed` 推进多次，补间速度变成 2 倍。
        ;(uniforms.uBaseColor.value as THREE.Color).copy(paletteTweened.primary)
        ;(uniforms.uHiColor.value as THREE.Color).copy(paletteTweened.highlight)
        ;(uniforms.uGlowColor.value as THREE.Color).copy(paletteTweened.secondary)
        ;(uniforms.uSolarColor.value as THREE.Color).copy(paletteTweened.highlight)

        // 可读性层跟随主网格
        if (row.readability && row.readabilityMaterial) {
          row.readability.visible = mesh.visible
          row.readability.position.y = mesh.position.y
          row.readability.position.z = mesh.position.z - 0.012
          row.readability.scale.copy(mesh.scale)
          // ★ renderOrder 每帧跟随主网格（上游 :1680 的 `- 0.04`）；
          //   建行时写的 `- 0.05`（:550）只是初值，会被这一行覆盖。
          //   主行 renderOrder 逐行递变（42.6 − dist×0.015），
          //   少了这一步，可读性层相对文字层的次序会固定低半档。
          row.readability.renderOrder = mesh.renderOrder - 0.04
          // 上游 :1685-1690：backdropAdapt 提升描边 mix 并整体加权
          const baseMix = isActive ? 0.74 : 0.52
          const readabilityMix = Math.max(baseMix, 0.6 + BACKDROP_ADAPT * 0.12)
          const readabilityBoost = 1 + BACKDROP_ADAPT * 0.78
          // 上游 :1694：target × readability(0.86) × mix × boost × depthFade
          const readabilityTarget = targetOpacity * 0.86 * readabilityMix * readabilityBoost * depthFade
          row.readabilityMaterial.opacity += (Math.min(1, readabilityTarget) - row.readabilityMaterial.opacity) * ease
          // 描边颜色向近黑 lerp（亮底避光，上游 lyricReadabilityColorForBrightBackdrop）
          row.readabilityMaterial.color.set('#ffffff').lerp(readabilityDarkColor, Math.min(0.92, BACKDROP_ADAPT * 0.92))
        }

        // ---- 辉光层（上游 :1708-1729）----
        // 跟随主网格（上游 glowLockedToText 分支：position/scale 直连 set），
        // z −0.030；透明度目标 = 激活行 target×rowGlow×(1+rowGlowBeat×0.46)×depthFade，
        // 非激活主行为 0（辉光只跟激活行）；渐变升 0.20 / 降 0.34。
        if (row.glow && row.glowMaterial) {
          row.glow.visible = mesh.visible
          row.glow.position.x = mesh.position.x
          row.glow.position.y = mesh.position.y
          row.glow.position.z = mesh.position.z - 0.03
          row.glow.scale.copy(mesh.scale)
          // 辉光颜色跟随封面调色板（上游 setLyricMaterialColor 每帧同步）
          row.glowMaterial.color.set(glowColor)
          const rowGlowBeat = Math.max(0, Math.min(1.5, glow.beatGlow))
          // ★ backdropAdapt 压暗项（上游 :1722）：`glowOpacityTarget *= (1 - adapt*0.30)`。
          //   上游把它加在**所有**行（含主行激活支）之后、无条件执行
          //   （只要 adapt > 0.001）。本项目此前只把 adapt 用在可读性层，
          //   于是亮封面下辉光比上游亮 —— 这正是"亮底避光"机制的一半。
          const backdropAdaptDim = 1 - BACKDROP_ADAPT * 0.3
          // 上游 :1720：target × rowGlow × (1 + rowGlowBeat×0.46) × depthFade
          const glowOpacityTarget = isActive
            ? targetOpacity * currentLineGlow * (1 + rowGlowBeat * 0.46) * depthFade * backdropAdaptDim
            : 0
          const glowOpacity = row.glowMaterial.opacity
          let nextGlowOpacity =
            glowOpacity + (glowOpacityTarget - glowOpacity) * (glowOpacityTarget > glowOpacity ? GLOW_RISE : GLOW_FALL)
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
    // ★ 译词行 → 父行索引的**反查表**，每帧建一次（第三十四轮性能修复，§5.4 D2）。
    //
    //   此前在裁剪循环内**逐行线性扫描 `lines`** 反查父行 —— 最坏 O(槽位数 × 行数)，
    //   120 行的歌配译词即 ~14400 次比较/帧。而这张表只由 `slotInfo` 决定，
    //   与 `active` 无关，因此每帧建一次即 O(行数)，之后查询 O(1)。
    const translationParentOf = new Int32Array(rows.length).fill(-1)
    for (let i = 0; i < lines.length; i++) {
      const count = slotInfo.transSlot[i]?.length ?? 0
      if (count <= 0) continue
      const base = lines.length + (slotInfo.transOffset[i] ?? 0)
      for (let k = 0; k < count; k++) {
        const slot = base + k
        if (slot >= 0 && slot < translationParentOf.length) translationParentOf[slot] = i
      }
    }
    for (let slotIndex = 0; slotIndex < rows.length; slotIndex++) {
      const row = rows[slotIndex]
      if (!row) continue
      let inKeepWindow: boolean
      if (slotIndex < lines.length) {
        inKeepWindow = slotIndex === active || (slotIndex >= keepLo && slotIndex <= keepHi)
      } else {
        // 译词行：直接查反查表（O(1)）
        const parent = translationParentOf[slotIndex]
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
    //
    // ★★ 上游 `tickMesh`（:2207-2222）还有一整层**组级运动**，此前整个漏掉了：
    //
    //     var a = min(1, age / (isCurrent ? motion.enter : motion.exit));
    //     a = a*a*(3 - 2*a);                       // smoothstep 揭示/退出包络
    //     rootScaleTarget = 0.96 + a*0.055 + breathe + bass*0.038 + beatPulse*0.014;
    //     enterOffsetY    = enterDir * lineStepWorld * (1 - a);
    //     progressLift   = -shownProgress * 0.026;
    //     pos.y = 0.20 + enterOffsetY + progressLift
    //           + (sin(t*0.55 + seed)*0.046 + sin(t*1.35 + seed)*0.012) * floatAmp
    //     pos.z = 1.48 - |enterDir|*0.045*(1 - a) + cos(t*0.48 + seed)*0.070 * floatAmp
    //     rot.z = (sin(t*0.34 + seed) * (style==='smooth'?0.006: style==='float'?0.026:0.018))
    //
    //   四项观感后果：换行时新行**从一侧滑上来并伴随 0.96→1.015 的放大**、
    //   逐字推进时文字**微微下沉**（progressLift）、静止时有呼吸与轻微**摆动**。
    //   本项目此前 `group.position` 每帧被**硬写**成固定值、`group.scale`
    //   只留了一个 0.006 的正弦 —— 因此换行是"瞬间换"而不是"滑入"，
    //   整组文字完全静止，是当前最大的单项目视差。
    //
    //   `age` 由换行事件重置（上游 :2213-2219 在 outgoing/current 上置 0），
    //   本项目用 `groupAgeRef` 承载；`enterDir` 取滚动方向
    //   （上游 `enterDirection`：`lineStep > 0 ? -1 : 1`）。
    const groupAge = groupAgeRef.current
    const groupEnter = Math.max(0.016, m.enter)
    const groupA = Math.min(1, groupAge / groupEnter)
    const groupASmooth = smoothstep(groupA)
    // 滚动方向 → 上游 enterDirection。本项目 scroll 递增 = 歌词向下走。
    const enterDir = trackVelocityRef.current >= 0 ? -1 : 1
    const enterOffsetY = enterDir * LYRIC_LINE_STEP_WORLD * (1 - groupASmooth)
    const progressLift = -shownProgressRef.current * 0.026
    // 呼吸（上游 `breathe`，:2450）—— 是**运行时双正弦**，不是风格常量：
    //   (sin(t*0.92 + seed)*0.050 + sin(t*0.41 + seed*0.7)*0.028) × floatAmp
    // 本项目此前把 `m.breathe`（一个自拟的风格常量）直接乘进缩放，量纲与
    // 上游完全不同：上游是 ±0.05 的呼吸，本项目是 ×1.0 的整体偏移。
    const seed = floatSeedRef.current
    const floatAmp = m.floatAmp
    const breathe = (Math.sin(t * 0.92 + seed) * 0.05 + Math.sin(t * 0.41 + seed * 0.7) * 0.028) * floatAmp
    const floatYGroup =
      (Math.sin(t * 0.55 + seed) * 0.046 + Math.sin(t * 1.35 + seed) * 0.012) * floatAmp
    // 节拍脉冲：上游 `beatPulse` 是主循环的量（11-main-loop.js:450-455，
    //   `max(rtPulse, min(0.12, bassOnset*0.18))` 再 `*= 0.36^dt`）。
    // 本项目没有等价的节拍脉冲量，用 `bands.beat`（引擎 frame 的同源投影）
    // 作为输入 —— 上游系数 0.014 保留，故整体幅度与上游同阶。
    const beatPulse = bands.beat
    const rootScaleTarget = 0.96 + groupASmooth * 0.055 + breathe + bands.bass * 0.038 + beatPulse * 0.014
    const baseY = 0.2 + enterOffsetY + progressLift + floatYGroup
    const baseZ =
      1.48 - Math.abs(enterDir) * 0.045 * (1 - groupASmooth) + Math.cos(t * 0.48 + seed) * 0.07 * floatAmp
    const layoutScale = rootScaleTarget
    // 行级 rot.z 摆动目标（上游 :2487 的 `rootRotationTarget`）。
    //
    // ★ 写在**组姿态段的末尾**而不是行循环里：行循环（`stepRow`）在本帧
    //   **更早**执行（见下方 `useFrame` 开头的顺序说明），若在那里现算，
    //   本帧用的是上一帧遗留值；写在段末则供**下一帧**的行循环消费 ——
    //   一帧延迟对这个 0.018 量级的慢摆动无感，但避免了同一帧内的顺序耦合。
    rowRootRotationRef.current =
      Math.sin(t * 0.34 + seed) * (motionStyle === 'smooth' ? 0.006 : motionStyle === 'float' ? 0.026 : 0.018)

    // 组级姿态 = 封面世界位姿 + 布局偏移（上游 :2202-2205）：
    //   group.position = coverPos + applyStageLyricLayoutOffset(layoutX/Y/Z)
    //   group.quaternion = coverQuat × tiltQuat
    // 上游 `layoutX/Y/Z` 与 `tiltX/tiltY` 出厂全 0（fx-defaults），因此
    // 组姿态就是封面位姿本身；本项目没有 FX 面板，直接锚定。
    //
    // ★★ `rot.z` 的摆动**不在组上**（上游 :2487 写在 `mesh` 上）——
    //   组四元数每帧被封面覆盖，把 `group.rotation.z` 累加上去等于每帧
    //   都在和封面四元数角力，结果是"封面转得快时摆动消失、转得慢时摆动
    //   叠加成漂移"。因此它由行循环施加到每行的 mesh（见 stepRow 处的
    //   `rowRootRotation`）。
    if (coverPose.active) {
      coverQuat.set(coverPose.quaternion.x, coverPose.quaternion.y, coverPose.quaternion.z, coverPose.quaternion.w)
      group.quaternion.copy(coverQuat)
      group.position.set(coverPose.position.x, coverPose.position.y + baseY, coverPose.position.z + LYRIC_PLANE_Z + baseZ)
    } else {
      group.quaternion.identity()
      // 固定姿态分支 = 地形模式专属；抬升量让主行落在舞台视觉中心。
      // 注意这里**仍然叠加**组级运动的 y/z/缩放 —— 地形模式同样换行、同样
      // 逐字推进，此前它比封面分支更静止。
      group.position.set(-SHELF_AVOID_X, SHELF_AVOID_Y + TOPOGRAPHY_LIFT_Y + baseY, LYRIC_PLANE_Z + SHELF_AVOID_Z + baseZ)
    }
    group.scale.setScalar(layoutScale)

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
