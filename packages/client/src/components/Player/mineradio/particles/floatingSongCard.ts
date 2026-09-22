import * as THREE from 'three'

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
 * 侧栏基准位姿的用户偏移（上游 `shelfLayoutProfile()` 的 `shelfCtl` 四项）。
 *
 * 上游出厂见 `04-fx-defaults.js:157-160`：
 *   shelfSize 0.92 / shelfOffsetX −0.34 / shelfOffsetY −0.20 / shelfOffsetZ +0.12
 * `sideY` 的基础值为 0（非 skull 档），因此出厂即 **−0.20**。
 *
 * ★★ 本项目把 `x` 由上游出厂 **−0.34 改为 0**（第三十三轮用户决策，第二次调整）。
 *
 *   上游歌单架默认**自动隐藏**（`fx.shelfPresence: 'auto'`），只在指针移到
 *   右侧热区时才带着淡入浮现，因此与封面重叠不构成问题。本项目未移植悬停
 *   召唤包络（§5.1），歌单架**常驻可见** —— 按上游 −0.34 摆放时卡片左缘
 *   67.4%，压住封面盘（69.3%）与 `emily` 方盘（70.0%）。
 *
 *   取值过程（实测 1600×900，各分辨率比例一致）：
 *
 *     x      卡片列              与 `emily` 方盘(70.04%) 的间距
 *     −0.34  67.4% .. 86.4%     −2.6%（压住）
 *     **0    70.7% .. 89.6%     +0.6%**（用户选定：贴上但不重叠）
 *     0.20   72.5% .. 91.5%     +2.5%（曾用值，用户觉"偏右、不和谐"）
 *
 *   用户先要求让开（→ 0.20），看到实际效果后判断"歌曲架偏右、不和谐"，
 *   再要求回到 **0** —— 即保留上游侧栏基准位（3.18，不含额外偏移），
 *   只消掉上游那个负偏移，让卡片与封面**贴着但不压住**。这是观感取舍，
 *   不是几何推导的结果。
 *
 *   `y` / `z` 仍严格取上游出厂值（−0.20 / +0.12）。
 *
 *   ★ 注意残余：`emily` 方盘在拖拽旋转到约 45° 时对角展宽到 78.3%，会
 *     探入卡片列。这不新引入问题 —— 粒子无硬边（唱片盘 `recordAlpha` 在
 *     `recordR` 附近 smoothstep 淡出），且卡片 `depthTest: false` +
 *     `renderOrder 300` 本就在粒子之上，重叠处表现为卡片遮挡粒子。
 *
 *   ★ 跟拍注视点必须同步（见 `SHELF_FOCUS_LOOK_AT_OFFSET`），否则推近后
 *     整列偏出画面中心。
 *
 *   ★ 歌词**不**跟着位移，恒定居中在封面正上方。上游的 `shelfLyricAvoid`
 *     （x −1.36 / y +0.06 / z +0.72）是配合 `fx.lyricCameraLock` 用的
 *     （歌词推到一边、相机锁过去）；本项目没有该开关、相机恒定看向封面，
 *     单独套用位移会让歌词离开封面轴心 —— 封面旋转时明显错位。
 *     让位改由歌单架侧承担。
 */
export const SHELF_CENTER = { x: 0, y: -0.2, z: 0.12 }

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
 * ★ `phi` / `lookAt.y` 仍取 0，那是**已登记的偏离 §2 D3**（"齐平"：
 *   悬停时整列卡片上下间隙必须对称）。上游竖屏是 `phi −0.06 / lookAt.y −0.18`，
 *   但 D3 的对称原则对所有档位一致，故不随档位变化。
 */
export interface ShelfFollowTier {
  theta: number
  radius: number
}

export function shelfFollowTier(viewport?: { width: number; height: number }): ShelfFollowTier {
  if (isPortraitShelfViewport(viewport)) return { theta: 0.24, radius: 5.28 }
  return { theta: 0.42, radius: 4.2 }
}

export function applyFloatingSongCardPose(
  mesh: THREE.Mesh,
  time: number,
  cardIndex: number,
  center: number,
  hover: number,
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
  // 指针视差（上游 placeCard side 分支，01-manager-core.js:422-491）：
  //   parWeight = max(0, 1 - absD*0.16)  — 离中心越近视差越强
  //   px += parX * 0.060 * parWeight;  py += parY * 0.046 * parWeight
  //   pz += (parY * 0.026 - parX * 0.028) * parWeight
  //   rotY += parX * 0.038 * parWeight;  rotX -= parY * 0.024 * parWeight
  // 此前完全没有这一层 —— "歌词/卡片没有跟随鼠标的 3D 相机感"的来源之一。
  const parX = shelfPointerParallax.x
  const parY = shelfPointerParallax.y
  const parWeight = Math.max(0, 1 - distance * 0.16)
  // 呼吸（上游 01-manager-core.js:470-471）：y 向 sin + z 向 cos 双摆动，
  // 且**乘 hoverBreath**（本项目卡片常驻无 shelfVisibility 淡入淡出，
  // 等价于上游 shelfAlwaysVisible 分支 → breath 门控恒 1，与常驻语义
  // 自洽；`Math.max(0.20, parWeight)` 的保底也按上游补上）。
  const breathWeight = Math.max(0.2, parWeight)
  const breath = Math.sin(time * 0.92 + cardIndex * 0.64) * 0.052 * breathWeight
  const breathZ = Math.cos(time * 0.78 + cardIndex * 0.52) * 0.03 * breathWeight
  mesh.position.set(
    sideX + distance * stepX - hover * (portrait ? 0.065 : 0.145) + parX * 0.06 * parWeight,
    sideY + -delta * stepY + breath + hover * (portrait ? 0.075 : 0.105) + parY * 0.046 * parWeight,
    (portrait ? 0.78 : 0.86) +
      SHELF_CENTER.z -
      distance * stepZ +
      breathZ +
      hover * 0.22 +
      (parY * 0.026 - parX * 0.028) * parWeight,
  )
  // OpenMusic 默认：桌面基础侧转 0.28rad，再叠加 -11° 卡片角度，
  // 最终约 +5°；当前项目此前误用了 -15°，结果只剩约 +1°，空间感偏平。
  const shelfAngleY = -11 * (Math.PI / 180)
  mesh.rotation.set(
    -delta * (portrait ? 0.022 : 0.042) - parY * 0.024 * parWeight,
    (portrait ? 0.12 : 0.28) + shelfAngleY - hover * 0.08 + parX * 0.038 * parWeight,
    0,
  )
  mesh.scale.setScalar(
    (distance < 0.5 ? 1.12 : Math.max(0.55, 1.04 - distance * 0.14)) * sideScale * (1 + hover * 0.05),
  )
  return distance
}
