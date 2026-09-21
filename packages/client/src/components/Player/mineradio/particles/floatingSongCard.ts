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

export function applyFloatingSongCardPose(
  mesh: THREE.Mesh,
  time: number,
  cardIndex: number,
  center: number,
  hover: number,
): number {
  const portrait = window.innerHeight > window.innerWidth
  const narrow = window.innerWidth < 980
  const delta = cardIndex - center
  const distance = Math.abs(delta)
  if (distance > 5.5) {
    mesh.visible = false
    return distance
  }
  mesh.visible = true
  /**
   * 侧栏基准位姿 —— 上游 `shelfLayoutProfile()`（`04-shelf/00-layout-hover.js:35-45`）
   * 在基础值上**再加用户偏移**，出厂偏移见 `04-fx-defaults.js:157-160`：
   *   shelfSize 0.92 / shelfOffsetX −0.34 / shelfOffsetY −0.20 / shelfOffsetZ +0.12
   * 而 `sideY` 的基础值是 0（非 skull 档），因此 `sideY` 出厂即 **−0.20**。
   *
   * 此前本项目只照搬了基础三元组（3.18 / 0.86 / scale 1），把四项出厂偏移
   * 整个漏掉 —— 于是整列卡片偏右 0.34、偏上 0.20、偏后 0.12，且每张卡片
   * **大 8.7%**（侧栏缩放 1 vs 出厂 0.92）。相对固定的跟拍机位
   * （lookAt(2.32,0,0.72) / radius 4.2）这是可见的位置与比例偏差。
   */
  const SHELF_CENTER = { x: -0.34, y: -0.2, z: 0.12 }
  const SHELF_SIZE = 0.92
  const sideX = (portrait ? 1.56 : narrow ? 2.48 : 3.18) + SHELF_CENTER.x
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
    sideX +
      distance * stepX -
      hover * (portrait ? 0.065 : 0.145) +
      parX * 0.06 * parWeight,
    sideY +
      -delta * stepY +
      breath +
      hover * (portrait ? 0.075 : 0.105) +
      parY * 0.046 * parWeight,
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
