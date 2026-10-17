import * as THREE from 'three'
import { SHELF_SUMMON } from './shelfSummonState'

export interface FloatingSongCardItem {
  title: string
  artist: string
  coverUrl: string | null
  tag: string
  meta: string
  progress: number
  bass: number
  centered: boolean
}

export interface FloatingSongCardMesh {
  mesh: THREE.Mesh
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

const coverCache = new Map<string, HTMLImageElement | 'loading' | 'failed'>()

/**
 * 封面缓存上限。
 *
 * 这个缓存是模块级的（卡片纹理需要跨重建复用），但队列会随着房间
 * 长期运行不断换歌。不设上限的话，每首新歌的封面位图都会永久驻留，
 * 长会话下持续增长。超出后按插入顺序淘汰最旧的一条。
 */
const COVER_CACHE_LIMIT = 64

function cacheCover(url: string, value: HTMLImageElement | 'loading' | 'failed') {
  // 先删再设，让它变成 Map 末尾的"最新"条目（Map 保持插入顺序）
  coverCache.delete(url)
  coverCache.set(url, value)
  if (coverCache.size > COVER_CACHE_LIMIT) {
    const oldest = coverCache.keys().next()
    if (!oldest.done) coverCache.delete(oldest.value)
  }
}

/** 清空封面缓存。舞台卸载时调用，释放位图。 */
export function clearFloatingSongCardCoverCache(): void {
  coverCache.clear()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const chars = [...text]
  const lines: string[] = []
  let line = ''
  for (const char of chars) {
    const candidate = line + char
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = char
      if (lines.length >= maxLines - 1) break
    } else {
      line = candidate
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight))
}

function requestCover(url: string, onReady: () => void) {
  const cached = coverCache.get(url)
  if (cached instanceof HTMLImageElement) {
    onReady()
    return
  }
  if (cached === 'loading' || cached === 'failed') return
  cacheCover(url, 'loading')
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.onload = () => {
    cacheCover(url, image)
    onReady()
  }
  image.onerror = () => cacheCover(url, 'failed')
  image.src = url
}

export function createFloatingSongCardMesh(): FloatingSongCardMesh {
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // 与 OpenMusic 保持一致：卡片挂进场景时立即可见。
    // 透明度仍会在 useFrame 中按层级平滑调整，但不能从 0 开始，
    // 否则首帧、暂停帧或低频刷新场景会出现“队列存在但卡片不可见”。
    opacity: 0.96,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.025), material)
  mesh.renderOrder = 55
  return { mesh, texture, canvas, ctx }
}

export function disposeFloatingSongCardMesh(card: FloatingSongCardMesh) {
  card.texture.dispose()
  ;(card.mesh.material as THREE.Material).dispose()
  card.mesh.geometry.dispose()
}

export function drawFloatingSongCard(
  card: FloatingSongCardMesh,
  item: FloatingSongCardItem,
  accent: string,
  time: number,
  hovered: boolean,
  onCoverReady: () => void,
) {
  const { ctx, canvas } = card
  const width = canvas.width
  const height = canvas.height
  const pad = 18
  const coverSize = height - pad * 2 - 8
  const coverX = pad + 6
  const coverY = pad + 4
  const textX = pad + coverSize + 22
  const textWidth = width - textX - pad - 24

  ctx.clearRect(0, 0, width, height)
  roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 32)
  ctx.fillStyle = item.centered ? 'rgba(4,7,12,0.88)' : 'rgba(4,7,12,0.72)'
  ctx.fill()
  const gradient = ctx.createLinearGradient(textX - 10, pad, width, height)
  gradient.addColorStop(0, 'rgba(255,255,255,0.10)')
  gradient.addColorStop(1, 'rgba(255,255,255,0.018)')
  ctx.save()
  roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 32)
  ctx.clip()
  ctx.fillStyle = gradient
  ctx.fillRect(textX - 10, pad, width - textX, height - pad * 2)
  ctx.restore()

  roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 32)
  ctx.strokeStyle = item.centered ? accent : 'rgba(255,255,255,0.15)'
  ctx.globalAlpha = item.centered ? 0.72 + Math.sin(time * 3) * 0.08 : 1
  ctx.lineWidth = item.centered ? 2 : 1.1
  ctx.stroke()
  ctx.globalAlpha = 1

  const cached = item.coverUrl ? coverCache.get(item.coverUrl) : null
  ctx.save()
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 26)
  ctx.clip()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(coverX, coverY, coverSize, coverSize)
  if (cached instanceof HTMLImageElement) {
    ctx.drawImage(cached, coverX, coverY, coverSize, coverSize)
  } else if (item.coverUrl && cached !== 'failed') {
    requestCover(item.coverUrl, onCoverReady)
  }
  ctx.restore()

  ctx.font = '700 16px "Plus Jakarta Sans", "Noto Sans SC", sans-serif'
  ctx.fillStyle = item.centered ? accent : 'rgba(255,255,255,0.82)'
  ctx.fillText(item.tag, textX, pad + 34)
  ctx.font = '700 27px "Plus Jakarta Sans", "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  wrapText(ctx, item.title, textX, pad + 70, textWidth, 31, 2)
  ctx.font = '400 16px "Plus Jakarta Sans", "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  wrapText(ctx, item.artist, textX, pad + 138, textWidth, 22, 2)
  ctx.font = '500 13px "Plus Jakarta Sans", "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(item.meta, textX, pad + 188)

  const actionWidth = 92
  const actionY = height - pad - 68
  roundRect(ctx, textX, actionY, actionWidth, 34, 17)
  ctx.fillStyle = hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'
  ctx.fill()
  ctx.strokeStyle = hovered ? accent : 'rgba(255,255,255,0.16)'
  ctx.stroke()
  ctx.font = '600 13px "Plus Jakarta Sans", "Noto Sans SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillText('打开队列', textX + actionWidth / 2, actionY + 17)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.strokeStyle = item.centered ? accent : 'rgba(255,255,255,0.3)'
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.moveTo(textX, height - pad - 22)
  ctx.lineTo(textX + Math.min(textWidth, 104 + item.progress * 160 + item.bass * 30), height - pad - 22)
  ctx.stroke()
}

export interface ShelfPointerParallax {
  /** 指针 NDC（-1..1）的低通值，上游 `pointerParallax.x/y` */
  x: number
  y: number
  /** 指针 NDC 目标值，上游 `pointerTarget.x/y` */
  targetX: number
  targetY: number
}

/**
 * 指针视差（上游 `pointerParallax` / `pointerTarget`，
 * 00-pointer-cover-particles.js:52 写入、11-main-loop.js:346-347 低通）：
 * mousemove 把 NDC 写入 target，每帧 `+= (target - value) * 0.040`。
 * 歌单卡片按它做轻微位移/旋转 —— 这就是上游「鼠标移动时卡片有 3D
 * 空间感」的来源。
 */
export const shelfPointerParallax: ShelfPointerParallax = { x: 0, y: 0, targetX: 0, targetY: 0 }

/** 每帧推进指针视差低通（上游 11-main-loop.js:346-347，固定 0.040）。 */
export function stepShelfPointerParallax(): void {
  shelfPointerParallax.x += (shelfPointerParallax.targetX - shelfPointerParallax.x) * 0.04
  shelfPointerParallax.y += (shelfPointerParallax.targetY - shelfPointerParallax.y) * 0.04
}

/**
 * 歌单架侧栏基准位置（上游 `shelfLayoutProfile()` 的基础三元组）。
 *
 * 导出为函数，供**跟拍相机**（`orbitCameraState.setShelfCameraFocus`）读取 ——
 * 卡片的实际横向位置与相机的注视点必须来自同一个数，否则改了一处忘了另一处
 * 就会让跟拍推近后整列偏心。见 `SHELF_CENTER` 处的说明。
 *
 * ★ 视口尺寸作为**可选参数**传入（默认取 `window`）：单测环境（node）没有
 *   `window`，直接读会让任何 import 本模块的测试在 import 期就崩。无 `window`
 *   时退回横屏基准值 —— 那是桌面默认档，也是测试断言的目标档位。
 */
/**
 * 歌单架的**竖屏/窄屏分档** —— 单一事实来源（第三十四轮统一，§5.4 C4）。
 *
 * ★ 上游 `isPortraitShelfViewport()`（`04-shelf/00-layout-hover.js:24-26`）是
 *   `innerHeight > innerWidth * 1.08`（**带 1.08 系数**），而 `shelfLayoutProfile()`
 *   就是用它同时决定 `sideX` 档位与卡片姿势的（`:28-46`）。
 *
 *   本项目此前**两处判据不一致**：
 *     · 本文件（`shelfSideX` 与 `applyFloatingSongCardPose`）用裸 `height > width`
 *     · `FloatingSongShelf` 的热区判定用上游的 `* 1.08`
 *   于是 1.00–1.08 这个比例带里，**卡片姿势走竖屏档、热区却走横屏档** ——
 *   卡片列与命中区错档。
 *
 *   现统一为上游口径（1.08），且三处共用本函数，杜绝再次分叉。
 */
export const SHELF_PORTRAIT_ASPECT = 1.08

/** 上游 `isPortraitShelfViewport()`。传 viewport 以便单测（node 无 `window`）。 */
export function isPortraitShelfViewport(viewport?: { width: number; height: number }): boolean {
  const view =
    viewport ?? (typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight })
  if (!view) return false
  return view.height > view.width * SHELF_PORTRAIT_ASPECT
}

/** 上游 `shelfLayoutProfile()` 的 `narrow`（横屏且宽度 < 980）。 */
export function isNarrowShelfViewport(viewport?: { width: number; height: number }): boolean {
  const view =
    viewport ?? (typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight })
  if (!view) return false
  return !isPortraitShelfViewport(view) && view.width < 980
}

export function shelfSideX(viewport?: { width: number; height: number }): number {
  // `window` 本身就是 `{ innerWidth, innerHeight }` 的形状，但类型上没有
  // `width`/`height` 字段，直接放进联合体会让下面的读取报错 —— 这里显式
  // 归一化成同一个形状。`typeof window === 'undefined'` 是 node（单测）环境。
  const view =
    viewport ?? (typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight })
  if (!view) return 3.18
  // ★ 判据统一走 `isPortraitShelfViewport`（上游口径，含 1.08 系数）——
  //   与 `applyFloatingSongCardPose`、`FloatingSongShelf` 的热区**同源**。
  //   此前这里与姿势用裸 `height > width`，而热区用 `* 1.08`，在临界比例上错档。
  const portrait = isPortraitShelfViewport(view)
  const narrow = isNarrowShelfViewport(view)
  return portrait ? 1.56 : narrow ? 2.48 : 3.18
}

/** 卡片平面的世界宽度（与 `createFloatingSongCardMesh` 的 PlaneGeometry 一致）。 */
export const SHELF_CARD_WIDTH = 2.05

/**
 * 侧栏基准位姿的用户偏移（上游 `shelfLayoutProfile()` 的 `shelfCtl` 三项半）。
 *
 * 上游出厂见 `04-fx-defaults.js:157-160`：
 *   shelfSize 0.92 / shelfOffsetX −0.34 / shelfOffsetY −0.20 / shelfOffsetZ +0.12
 * `sideY` 的基础值为 0（非 skull 档），因此出厂即 **−0.20**。
 *
 * ★★ 第三十三轮曾把 `x` 由上游出厂 −0.34 改成 0，理由是"卡片常驻可见时
 *   按 −0.34 摆放会压住封面盘"（卡片左缘 67.4% vs 封面 69.3%）。
 *
 *   **该偏离的根因已消除**：本项目现已移植上游的悬停召唤包络
 *  （`./shelfSummonState`），`fx.shelfPresence` 出厂 `'auto'` 的语义随之
 *  恢复 —— 静止态整列**不可见**，与封面重叠不构成问题；只有指针移到右缘
 *  热区停留 260ms 后卡片才淡入，彼时用户正在看歌单架，压住封面反而是
 *  上游的预期构图。
 *
 *   因此 `x` 回归上游出厂 **−0.34**，`y` / `z` 也一并对齐（−0.20 / +0.12）。
 *
 *   实测（1600×900，各分辨率比例一致）：
 *     x      卡片列              与 `emily` 方盘(70.04%) 的间距
 *     −0.34  67.4% .. 86.4%     −2.6%（压住；上游本来如此）
 *       0    70.7% .. 89.6%     +0.6%（第三十三轮的代偿值）
 *     0.20   72.5% .. 91.5%     +2.5%
 */
export const SHELF_CENTER = { x: -0.34, y: -0.2, z: 0.12 }

/**
 * 跟拍注视点相对卡片列中心的横向偏移（由上游出厂值倒推）—— **分档**。
 *
 * ============================ 推导（第三十四轮修，§5.4 C5） ============================
 *
 * 上游 `03-focus-cinema-camera.js:192-195` 的跟拍档：
 *
 *     orbit.focus.lookAt.set(shelfProfile.portrait ? 1.08 : 2.32, …)
 *     orbit.focus.theta = portrait ? 0.24 : 0.42
 *     orbit.focus.radius = portrait ? 5.28 : 4.20
 *
 * 即注视点 x **只有两档**（竖屏 1.08 / 其余 2.32），而卡片列的 `sideX`
 * 有**三档**（1.56 / 2.48 / 3.18）。把 `shelfCtl.x = −0.34` 算进列中心后：
 *
 *     列中心 = sideX − 0.34
 *     offset = 列中心 − lookAt.x
 *
 *     竖屏  1.56 − 0.34 = 1.22  →  1.22 − 1.08 = **+0.14**
 *     窄屏  2.48 − 0.34 = 2.14  →  2.14 − 2.32 = **−0.18**
 *     宽屏  3.18 − 0.34 = 2.84  →  2.84 − 2.32 = **+0.52**
 *
 * ★ 此前本项目对**所有档位**用同一个 0.52 —— 那是**宽屏档**的推导。
 *   于是窄屏下注视点落到 `2.48 − 0.52 = 1.96`，而上游是 2.32：**差 0.36 world**，
 *   推近后整列在构图里偏左。竖屏则恰好接近（1.56 − 0.52 = 1.04 vs 上游 1.08），
 *   所以只在窄屏上明显。
 */
export const SHELF_FOCUS_LOOK_AT_OFFSET = 0.52
/** 窄屏档的偏移（上游该档复用宽屏 lookAt.x 2.32，故为负）。 */
export const SHELF_FOCUS_LOOK_AT_OFFSET_NARROW = -0.18
/** 竖屏档的偏移。 */
export const SHELF_FOCUS_LOOK_AT_OFFSET_PORTRAIT = 0.14

/** 按当前视口取跟拍注视点的横向偏移（分档，见上）。 */
export function shelfFocusLookAtOffset(viewport?: { width: number; height: number }): number {
  if (isPortraitShelfViewport(viewport)) return SHELF_FOCUS_LOOK_AT_OFFSET_PORTRAIT
  if (isNarrowShelfViewport(viewport)) return SHELF_FOCUS_LOOK_AT_OFFSET_NARROW
  return SHELF_FOCUS_LOOK_AT_OFFSET
}

/**
 * 跟拍相机的档位参数（上游 `03-focus-cinema-camera.js:192-195`）。
 *
 * ★ 竖屏档此前**完全没移植**（§5.4 C5）：本项目对所有档位用宽屏的
 *   `theta 0.42 / radius 4.20`，于是竖屏上拉近幅度与侧角都比上游大。
 *   上游竖屏是 `theta 0.24 / radius 5.28` —— 更正面、更远。
 *
 * ★ `phi` / `lookAt.y` 此前归零（已登记偏离 §2 D3"齐平"）。**该偏离已撤销**
 *   （用户 2026-10-17 决策"相机跟拍 phi/lookAt.y 恢复上游值"）：歌单架现已
 *   有自动显隐（`shelfSummonState`），不再需要"整列常驻"来保对称，故恢复
 *   上游的俯拍档。上游 `03-focus-cinema-camera.js:193-195`：
 *     横屏  phi −0.12 / lookAt.y −0.10
 *     竖屏  phi −0.06 / lookAt.y −0.18
 *   （上游 preset 5 WALLPAPER 另有一档 phi 0.02 / lookAt.y −0.08 —— 本项目
 *    无该 preset，不移植。）
 */
export interface ShelfFollowTier {
  theta: number
  phi: number
  radius: number
  lookAtY: number
}

export function shelfFollowTier(viewport?: { width: number; height: number }): ShelfFollowTier {
  if (isPortraitShelfViewport(viewport)) {
    return { theta: 0.24, phi: -0.06, radius: 5.28, lookAtY: -0.18 }
  }
  return { theta: 0.42, phi: -0.12, radius: 4.2, lookAtY: -0.1 }
}

/**
 * 卡片撞击脉冲 —— 上游 `pulseObjectValue`（`00-state/08-desktop-render-power.js:1-11`）
 * + `pulseCard`（`04-shelf/01-manager-core.js:559-562`）。
 *
 * 上游：
 *   function pulseCard(card, amount) {
 *     if (!card) return;
 *     pulseObjectValue(card, 'fxPulse', amount || 1, 0.46);
 *   }
 * 而 `pulseObjectValue` 用 gsap 把 `card.fxPulse` 从 `amount` 以
 * `power3.out` 缓到 0，时长 `duration`（秒）。
 *
 * `power3.out` 的解析式是 `1 - (1 - t)^3`。本项目没有 gsap，因此这里
 * 手写同一个缓动 + 一个显式的衰减 ticker：
 *
 *   fxPulse = amount * (1 - (1 - t)^3),  t = (now - start) / duration
 *
 * 与 gsap 的关键差别只在**没有 killTweensOf**：上游重复触发会打断上一次
 * 补间、从**新**的 amount 重新起跑（且取 `max(旧值, amount)` 作起点）。
 * 这里用 `pulseStartedAt` + `pulseFrom`（起点值）复刻同一语义：
 * 重触发时 `pulseFrom = max(当前剩余值, amount)`、重设开始时刻。
 *
 * ★ 为什么要移植：`fxPulse` 同时进**缩放**（`+ pulse*0.056`）与
 *   **不透明度**（`+ pulse*0.10*reveal`）。缺了它，滚轮换歌、点开歌单
 *   这些动作在视觉上完全静音 —— 上游是"卡片弹一下"的。
 */
export interface CardPulse {
  /** 上游 `card.fxPulse` —— 当前脉冲量 */
  value: number
  /** 脉冲起点量（重触发时取 `max(剩余, amount)`） */
  from: number
  /** 起始时刻（ms，`performance.now()` 同源） */
  startedAt: number
}

/** 上游 `pulseCard` 的默认时长（`pulseObjectValue(..., 0.46)`）。 */
export const SHELF_CARD_PULSE_DURATION = 0.46

export function createCardPulse(): CardPulse {
  return { value: 0, from: 0, startedAt: 0 }
}

/** 上游 `power3.out` 的解析式。 */
function power3Out(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - (1 - c) * (1 - c) * (1 - c)
}

/**
 * 触发一次脉冲 —— 上游 `pulseCard(card, amount)`。
 *
 * @param pulse  卡片自持的脉冲槽
 * @param amount 目标量（上游调用点：1.05 / 0.55 / 1.0 / 0.70 / 1.0）
 * @param now    当前时刻（ms）
 */
export function pulseCard(pulse: CardPulse, amount: number, now: number): void {
  stepCardPulse(pulse, now)
  // 上游 `target[key] = Math.max(target[key] || 0, amount || 1)` ——
  // 取 max：正在衰减的更强脉冲不得被更弱的请求压低。
  const next = Math.max(pulse.value, amount || 1)
  pulse.from = next
  pulse.startedAt = now
  pulse.value = next
}

/**
 * 推进脉冲衰减 —— 每帧调用。返回推进后的值（便于断言与日志）。
 *
 * 上游由 gsap 在后台跑，因此没有显式的这一步；本项目是同步的逐帧循环，
 * 必须在读 `fxPulse` **之前**先推进它（gsap 的更新时机同样是帧首）。
 */
export function stepCardPulse(pulse: CardPulse, now: number): number {
  if (pulse.value <= 0 || pulse.from <= 0) {
    if (pulse.value < 0) pulse.value = 0
    return pulse.value
  }
  const t = (now - pulse.startedAt) / (SHELF_CARD_PULSE_DURATION * 1000)
  if (t >= 1) {
    pulse.value = 0
    pulse.from = 0
    return 0
  }
  pulse.value = pulse.from * power3Out(t)
  if (pulse.value < 0.0005) pulse.value = 0
  return pulse.value
}

/**
 * 单张卡片姿态的**上游包络输入**。
 *
 * 上游 `placeCard`（`01-manager-core.js:415-512`）在 side 分支里一共读了
 * 六组量，本项目此前只喂了其中一组（指针 hover，且是**直接**当偏移用，
 * 与上游的 lift 语义不同）：
 *
 *   hoverBreath   呼吸门控 = `shelfVisibility`（:441）—— 不是常数 1
 *   lift          选中抬升（:443-448）—— 与指针 hover **不是一回事**
 *   reveal        逐卡 stagger 揭示（:453）
 *   entry         由 reveal 推出的入场位移/缩放（:454）
 *   pulse         撞击脉冲 `card.fxPulse`（:425）
 *   paneEase      歌单页切换（本项目无该概念，恒 0）
 *
 * `paneEase` 不设字段：上游它是 `switchPane`（我的歌单/收藏）时才非零的
 * 过渡量，本项目没有"歌单页"这个容器概念，因此整条 pane 支路（
 * `px += paneEase * paneSwitchDir * 0.60` 等三行、以及不透明度里的
 * `(1 - paneEase * 0.24)`）按 paneEase ≡ 0 折叠掉。
 *
 * ★ `parallax`（上游 `summon.parallax`，出厂 1）已在模块内固定为 1，
 *   故不出现在入参里。
 */
export interface ShelfCardPoseInput {
  /** 上游 `shelfVisibility`（0..1）—— 呼吸门控与整体淡入共用它 */
  visibility: number
  /** 上游 `card.floatMix`（0..1）—— 选中抬升量，双速趋近 */
  lift: number
  /** 上游 `reveal`（0..1）—— smoothstep 后的逐卡揭示量 */
  reveal: number
  /** 上游 `card.fxPulse`（0..）—— 撞击脉冲 */
  pulse: number
  /** 指针视差量（上游 `pointerParallax.x/y`，已低通到 [-1,1]） */
  parX: number
  parY: number
}
/**
 * 侧栏卡片姿态 —— 逐行对照上游 `placeCard` 的 side 分支。
 *
 * 上游 `01-manager-core.js:436-505`。本项目此前缺了 reveal/entry 的
 * **位姿**分量（只在不透明度里用了 reveal）、`hoverBreath` 的
 * `shelfVisibility` 门控、`lift` 抬升与 `pulse` 撞击 —— 全部在这一处补齐。
 */
export function applyFloatingSongCardPose(
  mesh: THREE.Mesh,
  time: number,
  cardIndex: number,
  center: number,
  input: ShelfCardPoseInput,
): number {
  // ★ 分档判据统一走 `isPortraitShelfViewport` / `isNarrowShelfViewport`
  //   （上游口径，含 1.08 系数）—— 与 `shelfSideX`、`FloatingSongShelf` 的热区
  //   **同源**（第三十四轮统一，§5.4 C4）。此前这里用裸 `height > width`，
  //   在 1.00–1.08 比例带上与热区判定错档。
  const portrait = isPortraitShelfViewport()
  const narrow = isNarrowShelfViewport()
  const delta = cardIndex - center
  const distance = Math.abs(delta)
  if (distance > 5.5) {
    mesh.visible = false
    return distance
  }
  mesh.visible = true
  // 侧栏基准位姿：位置/尺寸常量见模块顶部 `SHELF_CENTER` / `shelfSideX()`
  //（跟拍相机的注视点也读同一组常量，避免两处漂移）。
  const SHELF_SIZE = 0.92
  const sideX = shelfSideX() + SHELF_CENTER.x
  const sideY = SHELF_CENTER.y
  const sideScale = (portrait ? 0.7 : narrow ? 0.86 : 1) * SHELF_SIZE
  // 三轴步长（上游 04-shelf/00-layout-hover.js:35-37 sideXStep/sideYStep/sideZStep，
  // 横屏 0.040/0.68/0.170、竖屏 0.018/0.52/0.118）：此前写 0.18/0.74/0.19，
  // x 向差 4.5 倍 —— 整列呈斜向扇形，上游是近乎垂直的列。
  const stepX = portrait ? 0.018 : 0.04
  const stepY = portrait ? 0.52 : 0.68
  const stepZ = portrait ? 0.118 : 0.17
  // 入场横移量（上游 00-layout-hover.js:38 `sideEntryX`，竖屏 0.38 / 其余 0.82）：
  // reveal 未完成时卡片从**侧面**滑入列内（:462 `entry * layout.sideEntryX`）。
  // 此前整个没移植 —— 浮现时卡片是"原地淡入"，没有"滑进队列"的过程。
  const sideEntryX = portrait ? 0.38 : 0.82
  // 指针视差（上游 placeCard side 分支，01-manager-core.js:422-491）：
  //   parWeight = max(0, 1 - absD*0.16)  — 离中心越近视差越强
  //   px += parX * 0.060 * parWeight;  py += parY * 0.046 * parWeight
  //   pz += (parY * 0.026 - parX * 0.028) * parWeight
  //   rotY += parX * 0.038 * parWeight;  rotX -= parY * 0.024 * parWeight
  // 此前完全没有这一层 —— "歌词/卡片没有跟随鼠标的 3D 相机感"的来源之一。
  const parX = input.parX
  const parY = input.parY
  const parWeight = Math.max(0, 1 - distance * 0.16)
  // 上游 `01-manager-core.js:425`：`var pulse = card.fxPulse || 0;`
  const pulse = input.pulse || 0
  // 上游 `01-manager-core.js:441`：
  //   `hoverBreath = (!shelfPinnedOpen && !detailOpenSide) ? shelfVisibility : 0`
  // 本项目两项（固定开关 / 详情面板）都没有 ⇒ 门控就是 `shelfVisibility`。
  //
  // ★ 此前这里是**常数 1**，理由写"本项目卡片常驻无 shelfVisibility 淡入
  //   淡出，等价于上游 alwaysVisible 分支"。该前提在悬停召唤包络
  //   （`./shelfSummonState`）移植后已不成立：静止态 visibility 为 0，
  //   若呼吸仍按 1 计，整列在不可见时仍会摆动 —— 而摆幅正是由
  //   `shelfVisibility` 决定的（上游 :441）。
  const hoverBreath = input.visibility
  // 上游 `01-manager-core.js:452`：
  //   `breathPulse = hoverBreath * (0.5 + 0.5 * sin(nowT * 1.22 + card.index * 0.74))`
  // 它只进**缩放与不透明度**，不进位置（位置用的是下面那条裸 sin/cos）。
  const breathPulse = hoverBreath * (0.5 + 0.5 * Math.sin(time * 1.22 + cardIndex * 0.74))
  // 上游 `01-manager-core.js:453-455`：reveal 带 absD 的 stagger（由调用方
  // 经 `shelfCardReveal` 算出，与本函数共用同一组 summon 出厂值），
  // `entry` 是它推出的入场量：
  //   entry = (1 - reveal) * (0.82 + absD * 0.075 * stagger) * slide
  // `slide` 出厂 1.9（shelfSummonSettings）。stagger 已在 reveal 内。
  const reveal = input.reveal
  const entry = (1 - reveal) * (0.82 + distance * 0.075) * SHELF_SUMMON.slide
  // 呼吸（上游 01-manager-core.js:470-471）：y 向 sin + z 向 cos 双摆动，
  // 乘 **hoverBreath**（上游 :441，即 shelfVisibility）与 `max(0.20, parWeight)`
  // 的保底（y 向）/ `parWeight`（z 向）—— 两侧的下限不同，别合并。
  const breathWeight = Math.max(0.2, parWeight)
  const breath = Math.sin(time * 0.92 + cardIndex * 0.64) * 0.052 * hoverBreath * breathWeight
  const breathZ = Math.cos(time * 0.78 + cardIndex * 0.52) * 0.03 * hoverBreath * parWeight
  // 上游 `01-manager-core.js:443-448`：抬升量双速趋近（升 0.20 / 降 0.13），
  // 由调用方持有 `floatMix`；这里只消费结果 `lift`。
  const lift = input.lift || 0
  // ---- 位置（上游 :459-471，paneEase ≡ 0 已折叠）----
  const px = sideX + distance * stepX + entry * sideEntryX
  const py = sideY - delta * stepY + (1 - reveal) * (delta < 0 ? -0.18 : 0.18) * SHELF_SUMMON.slide
  const pz = (portrait ? 0.78 : 0.86) + SHELF_CENTER.z - distance * stepZ - (1 - reveal) * 0.2 * SHELF_SUMMON.slide
  // 指针视差（上游 :472-474，`summon.parallax` 出厂 1）
  const parrX = parX * 0.06 * parWeight
  const parrY = parY * 0.046 * parWeight
  const parrZ = (parY * 0.026 - parX * 0.028) * parWeight
  // 抬升（上游 :475-480）：选中卡向画面外/上方前移。
  //   skull 档（本项目无）另有一组更小的值，不移植。
  const liftX = -lift * (portrait ? 0.065 : 0.145)
  const liftY = lift * (portrait ? 0.075 : 0.105)
  const liftZ = lift * 0.22
  mesh.position.set(
    px + parrX + liftX,
    py + breath + parrY + liftY,
    pz + breathZ + parrZ + liftZ,
  )
  // OpenMusic 默认：桌面基础侧转 0.28rad，再叠加 -11° 卡片角度，
  // 最终约 +5°；当前项目此前误用了 -15°，结果只剩约 +1°，空间感偏平。
  //
  // ★ `shelfAngleY` 出厂 −11° 来自 `fxDefaults.shelfAngleY`（:161）且
  //   `shelfAngleYManual: true`（:162）—— 上游**不是**用
  //   `shelfDefaultAngleForCameraMode`（dynamic 档会给 0），而是用手动值。
  //   因此这里恒取 −11°，不随相机模式变。
  const shelfAngleY = -11 * (Math.PI / 180)
  // 上游 :488-492：rotY = sideRotY + (1-reveal)*0.16*slide + parX*0.038*parWeight
  //   （非壁纸/骷髅安全档 ⇒ `safeEntryRotY = 0.16`）
  // rotX = -delta*sideRotX - parY*0.024*parWeight
  mesh.rotation.set(
    -delta * (portrait ? 0.022 : 0.042) - parY * 0.024 * parWeight,
    (portrait ? 0.12 : 0.28) + shelfAngleY + (1 - reveal) * 0.16 * SHELF_SUMMON.slide + parX * 0.038 * parWeight,
    0,
  )
  // 缩放（上游 :493-499）：距离衰减 × revealScale × (1 + pulse + breathPulse + lift)
  //   `revealScale = 1 - (1 - reveal) * 0.12 * summon.scale`，scale 出厂 1。
  const revealScale = 1 - (1 - reveal) * 0.12
  mesh.scale.setScalar(
    (distance < 0.5 ? 1.12 : Math.max(0.55, 1.04 - distance * 0.14)) *
      revealScale *
      (1 + pulse * 0.056 + breathPulse * 0.026 + lift * 0.075) *
      sideScale,
  )
  return distance
}
