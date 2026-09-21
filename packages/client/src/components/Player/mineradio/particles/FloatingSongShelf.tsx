import { getProxiedCoverUrl } from '@/lib/cover'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useFrame, useThree } from '@react-three/fiber'
import type { Track } from '@music-together/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { readAudioBands } from '../shared/AudioAnalyser'
import {
  applyFloatingSongCardPose,
  clearFloatingSongCardCoverCache,
  createFloatingSongCardMesh,
  disposeFloatingSongCardMesh,
  drawFloatingSongCard,
  shelfPointerParallax,
  stepShelfPointerParallax,
  type FloatingSongCardMesh,
} from './floatingSongCard'
import { clearShelfFocus, orbitCameraState, setShelfCameraFocus } from './orbitCameraState'
import { registerShelfHitTester } from './shelfHitRegistry'

const MAX_SHELF_ITEMS = 24

/** 退出跟拍的延迟（上游 `exitTimer`，03-focus-cinema-camera.js:246）。 */
const SHELF_EXIT_DELAY_MS = 120

interface FloatingSongShelfProps {
  accent: string | null
  onOpenQueue: () => void
  maxItems: number
  motionEnabled: boolean
}

function trackKey(track: Track): string {
  return `${track.source}:${track.sourceId}:${track.id}`
}

/**
 * 右侧歌单架的三个屏幕矩形区域 —— 对照 Mineradio `04-shelf/00-layout-hover.js`。
 *
 * 上游的召唤、滚轮浏览、点击**全部**是屏幕空间矩形判定，射线只用来决定
 * "高亮哪一张卡"。这一点是**功能性**的，不只是风格差异：
 *
 * 卡片固定在**世界坐标**，不跟随相机。一旦相机移到跟拍位
 * （`setShelfCameraFocus(true)` → `radius 4.2`），卡片就不再落在指针射线上。
 * 上游因为滚轮判定里有**屏幕矩形兜底**（`isShelfWheelZone(e) || cardWheelHit`），
 * 依然能滚动；若只用射线，滚轮会打空并穿透给相机变成缩放。
 *
 * 本文件此前把点击/滚轮都门控在射线命中上，正是「相机变换后无法滚动」的根因。
 */

/** 竖屏判定（上游 `isPortraitShelfViewport`）。 */
function isPortraitShelfViewport(): boolean {
  return window.innerHeight > window.innerWidth * 1.08
}

/** 悬停热区宽度（上游 `shelfHotZoneWidth`）：竖屏 26% / 横屏 18%，夹 [148, 280/360]。 */
function shelfHotZoneWidth(): number {
  const portrait = isPortraitShelfViewport()
  const ratio = portrait ? 0.26 : 0.18
  return Math.min(portrait ? 280 : 360, Math.max(148, window.innerWidth * ratio))
}

/**
 * 滚轮区域宽度（上游 `shelfWheelZoneWidth`）：
 * `min(竖屏 280 / 横屏 360, max(热区宽, 视口宽 * 竖屏 0.24 / 横屏 0.18))`。
 */
function shelfWheelZoneWidth(): number {
  const portrait = isPortraitShelfViewport()
  const ratioWidth = window.innerWidth * (portrait ? 0.24 : 0.18)
  return Math.min(portrait ? 280 : 360, Math.max(shelfHotZoneWidth(), ratioWidth))
}

/** 指针是否落在悬停热区内（上游 `isShelfClickZone` 的非 pinned 分支：Y 130 / innerHeight-150）。 */
function isInShelfHotZone(clientX: number, clientY: number): boolean {
  const edge = shelfHotZoneWidth()
  return clientX > window.innerWidth - edge && clientY > 130 && clientY < window.innerHeight - 150
}

/** 指针是否落在滚轮区内（上游 `isShelfWheelZone`：Y 116 / innerHeight-116）。 */
function isInShelfWheelZone(clientX: number, clientY: number): boolean {
  const edge = shelfWheelZoneWidth()
  return clientX > window.innerWidth - edge && clientY > 116 && clientY < window.innerHeight - 116
}

/**
 * 指针是否压在 HUD DOM 元素上（上游 `isPointerOverUi`）。
 *
 * 上游 `UI_HIT_SELECTOR` 列出全部 HUD 容器（#top-right/#fx-fab/#bottom-bar…），
 * 悬停判定与卡片选中都先过这一关。本项目画布之上有模式菜单、控制栏、
 * 投票横幅等兄弟节点 —— 指针落在它们上面时**不得**触发卡片悬停/跟拍。
 */
function isPointerOverUi(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined') return false
  const el = document.elementFromPoint(clientX, clientY)
  if (!el) return false
  return !el.closest('.mt-mineradio-canvas-layer')
}

/**
 * 把卡片 mesh 的四个角投影到屏幕，返回屏幕 AABB（像素）。
 *
 * 对照 Mineradio `04-shelf/01-manager-core.js:688-713` 的 `screenHitCard`：
 * 取真实的 `matrixWorld`（而不是假设的固定位置），因此卡片跟随滚动/浮动/
 * 跟拍移动后，命中区域也随之移动。
 */
function projectedCardRect(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  canvasRect: DOMRect,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const geometry = mesh.geometry as THREE.BufferGeometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb) return null

  mesh.updateMatrixWorld(true)
  const { min, max } = bb
  const corners = [
    [min.x, min.y, 0],
    [max.x, min.y, 0],
    [min.x, max.y, 0],
    [max.x, max.y, 0],
  ] as const

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y, z] of corners) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    const sx = canvasRect.left + ((p.x + 1) / 2) * canvasRect.width
    const sy = canvasRect.top + ((1 - p.y) / 2) * canvasRect.height
    minX = Math.min(minX, sx)
    maxX = Math.max(maxX, sx)
    minY = Math.min(minY, sy)
    maxY = Math.max(maxY, sy)
  }
  return { minX, maxX, minY, maxY }
}

/** OpenMusic 的 3D 队列架，交互映射到本项目已有的队列抽屉。 */
export function FloatingSongShelf({ accent, onOpenQueue, maxItems, motionEnabled }: FloatingSongShelfProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const queue = useRoomStore((state) => state.room?.queue ?? EMPTY_QUEUE)
  const { camera, gl } = useThree()
  const cardsRef = useRef<FloatingSongCardMesh[]>([])
  const drawKeysRef = useRef<string[]>([])
  const hoversRef = useRef<number[]>([])
  const centerTargetRef = useRef(0)
  const centerSmoothRef = useRef(0)
  const hoveredRef = useRef(-1)
  const [cardCount, setCardCount] = useState(0)

  /**
   * 悬停状态（对照上游 `shelfHoverCue`）。
   *
   * - `zoneActive` 指针在热区内
   * - `enteredAt`  进入热区的时刻，用于 260ms 停留判定
   * - `exitAt`     离开热区的时刻；退出跟拍要等 120ms（上游 `exitTimer`）
   */
  const hoverCueRef = useRef({ zoneActive: false, enteredAt: 0, exitAt: 0 })

  /**
   * 队列卡片（对照上游 04-shelf/01-manager-core.js currentItems + rebuild）：
   *
   * 上游的歌单架是"一条按播放顺序排列的队列"，当前曲目在队列中的真实位置
   * 就是轨道中心（sig() 含 currentIdx，切歌 → rebuild → centerTarget =
   * currentIdx），卡片随之平滑滚动。本项目房间语义相同：currentTrack 通常
   * 仍在 queue 中占位（removePlayedTracks 关闭时）。
   *
   * ★ 关键差异修复：此前 `queue.slice(0, N)` 从队头截断 —— 当前曲目一旦
   * 排到窗口外，歌单架就"找不到当前歌、也永不滚动"。现改为**以当前曲目
   * 为中心取滑动窗口**：窗口随 currentIdx 移动，当前歌永远可见且居中，
   * 上方是已播历史、下方是待播 —— 与上游"随播放顺序丝滑滚动"一致。
   */
  const shelfWindow = useMemo(() => {
    const limit = Math.min(MAX_SHELF_ITEMS, maxItems)
    if (queue.length === 0) return { tracks: [] as Track[], start: 0 }
    if (!currentTrack) return { tracks: queue.slice(0, limit), start: 0 }
    const key = trackKey(currentTrack)
    let idx = queue.findIndex((track) => trackKey(track) === key)
    if (idx < 0) {
      // 当前曲目不在队列（removePlayedTracks 已移除等）：虚拟插到窗口顶部，
      // 保证"正在播放"卡片始终存在
      return { tracks: [currentTrack, ...queue.slice(0, Math.max(0, limit - 1))], start: -1 }
    }
    // 窗口中心尽量对准当前曲目，但允许其偏下（多留待播、少留已播）
    const history = Math.min(idx, Math.floor(limit / 3))
    const start = Math.max(0, Math.min(idx - history, queue.length - limit))
    idx = idx - start
    return { tracks: queue.slice(start, start + limit), start }
  }, [currentTrack, maxItems, queue])
  const tracks = shelfWindow.tracks
  /** 当前曲目在窗口中的位置（上游 currentIdx），驱动 centerTarget。 */
  const currentIdx = useMemo(() => {
    if (!currentTrack) return -1
    const key = trackKey(currentTrack)
    return tracks.findIndex((track) => trackKey(track) === key)
  }, [currentTrack, tracks])

  useEffect(() => {
    while (cardsRef.current.length < tracks.length) {
      const card = createFloatingSongCardMesh()
      card.mesh.userData.cardIndex = cardsRef.current.length
      cardsRef.current.push(card)
      drawKeysRef.current.push('')
      hoversRef.current.push(0)
    }
    while (cardsRef.current.length > tracks.length) {
      const card = cardsRef.current.pop()
      if (card) disposeFloatingSongCardMesh(card)
      drawKeysRef.current.pop()
      hoversRef.current.pop()
    }
    centerTargetRef.current = Math.min(centerTargetRef.current, Math.max(0, tracks.length - 1))
    setCardCount(tracks.length)
  }, [tracks.length])

  /**
   * 窗口滑动的滚动动画：窗口起点随当前曲目移动是**离散**的（slice 边界
   * 跳变），卡片纹理瞬间换位 —— 这里把每次窗口位移量记为待补偿的偏移，
   * useFrame 里给卡片 y 加上该偏移并缓动回 0，观感即"整列丝滑滚动一格"
   * （上游 rebuild 的卡片滑动由 centerSmooth 缓动承担，等价补偿）。
   */
  const scrollOffsetRef = useRef(0)
  const prevStartRef = useRef(-1)
  useEffect(() => {
    // 窗口起点变化（≥0 → ≥0）= 整列卡片内容位移；差值进入滚动补偿
    const prev = prevStartRef.current
    if (prev >= 0 && shelfWindow.start >= 0) {
      scrollOffsetRef.current += prev - shelfWindow.start
    }
    prevStartRef.current = shelfWindow.start
    if (currentIdx >= 0) centerTargetRef.current = currentIdx
  }, [currentIdx, shelfWindow.start])

  useEffect(
    () => () => {
      gl.domElement.style.cursor = ''
      clearShelfFocus()
      // `orbitCameraState` 是**模块级单例**：组件会重建但状态不会。
      // 卸载时必须把自己写进去的状态一并清掉，否则下次挂载会带着旧
      // 指针位置进入，热区悬停会在指针移入前就被误判为"在热区内"。
      orbitCameraState.pointerSlot = null
      registerShelfHitTester(null)
      cardsRef.current.forEach(disposeFloatingSongCardMesh)
      cardsRef.current = []
      clearFloatingSongCardCoverCache()
    },
    [gl],
  )

  /** 屏幕坐标 → 画布 NDC，供离散事件（点击/滚轮）使用。 */
  const toNdc = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
    },
    [gl],
  )

  /** 离散事件侧的卡片命中：仅在点击/滚轮时使用，不参与逐帧判定。 */
  /**
   * 卡片命中 —— 对照 Mineradio `04-shelf/05-card-interactions.js:9-12`
   * 的 `pointerCardHit`：**先射线，失败再退回屏幕空间 AABB**。
   *
   *   1. `raycastCards(rc)`：实时光线 vs 真实 mesh
   *   2. `pickCardAtScreen` / `screenHitCard`：把卡片**当前的 matrixWorld 四角
   *      投影到屏幕**，取 AABB 并 pad 后测试指针
   *
   * 此前本项目**只有射线**，于是当射线因为背面/深度/矩阵未更新等原因打空时，
   * 明明指针压在卡片上却点不中 —— 正是用户说的"像固定坐标、不在真实卡片上"。
   */
  const raycastCardAt = useCallback(
    (clientX: number, clientY: number, pad = 28) => {
      const ndc = toNdc(clientX, clientY)
      const meshes = cardsRef.current.map((card) => card.mesh).filter((mesh) => mesh.visible)
      if (meshes.length === 0) return -1
      meshes.forEach((mesh) => mesh.updateMatrixWorld(true))

      // ---- 1) 射线命中 ----
      if (ndc) {
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(ndc, camera)
        const hits = raycaster.intersectObjects(meshes, false)
        // 上游取 hits[0]（最近的一张），不按"是否居中"挑选
        if (hits.length > 0) {
          const idx = Number(hits[0].object.userData.cardIndex ?? -1)
          if (idx >= 0) return idx
        }
      }

      // ---- 2) 屏幕空间 AABB 兜底（上游 screenHitCard）----
      const glRect = gl.domElement.getBoundingClientRect()
      if (glRect.width <= 0 || glRect.height <= 0) return -1
      // 由远及近检查，近的覆盖远的（上游按 renderOrder 排序）
      const ordered = [...cardsRef.current]
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => card.mesh.visible)
        .sort((a, b) => b.card.mesh.renderOrder - a.card.mesh.renderOrder)
      for (const { card, index } of ordered) {
        const box = projectedCardRect(card.mesh, camera, glRect)
        if (!box) continue
        if (
          clientX >= box.minX - pad &&
          clientX <= box.maxX + pad &&
          clientY >= box.minY - pad &&
          clientY <= box.maxY + pad
        ) {
          return index
        }
      }
      return -1
    },
    [camera, gl, toNdc],
  )

  // 把卡片命中判定共享给 CameraRig 的双击门控（上游 dblclick 先射线卡片，
  // 命中则跳过回正；本项目两层是兄弟组件，经注册表桥接）。
  useEffect(() => {
    registerShelfHitTester((clientX, clientY) => raycastCardAt(clientX, clientY) >= 0)
    return () => registerShelfHitTester(null)
  }, [raycastCardAt])

  useEffect(() => {
    const canvas = gl.domElement
    // 上游 `canInteract()`：有内容才允许交互。
    const canInteract = () => tracks.length > 0

    const stopCardEvent = (event: PointerEvent) => {
      if (!canInteract()) return
      // 上游 stop 的是「落在卡片上」的 pointerdown：优先射线命中，
      // 射线打空时退回悬停热区（上游 `isShelfClickZone`）。
      const hitCard = raycastCardAt(event.clientX, event.clientY) >= 0
      if (!hitCard && !isInShelfHotZone(event.clientX, event.clientY)) return
      // 点在卡片上时不要触发轨道拖拽
      orbitCameraState.rotating = false
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    const onClick = (event: MouseEvent) => {
      if (!canInteract()) return
      // 上游点击用射线命中卡片（`pointerCardHit` + `pickCardAtScreen` 兜底）
      if (raycastCardAt(event.clientX, event.clientY) < 0) return
      event.stopImmediatePropagation()
      event.preventDefault()
      onOpenQueue()
    }
    const onWheel = (event: WheelEvent) => {
      // ★ 关键：上游 `inShelfArea = isShelfWheelZone(e) || !!cardWheelHit`
      //   —— 屏幕矩形**或**射线命中都能滚，因此相机变换后依然可滚。
      //   此前只用射线，相机一移就滚不动且事件穿透给相机缩放。
      if (!canInteract() || tracks.length < 2) return
      const hitCard = raycastCardAt(event.clientX, event.clientY) >= 0
      const inWheelZone = isInShelfWheelZone(event.clientX, event.clientY)
      if (!hitCard && !inWheelZone) return
      event.stopImmediatePropagation()
      event.preventDefault()
      centerTargetRef.current = Math.max(
        0,
        Math.min(tracks.length - 1, centerTargetRef.current + (event.deltaY > 0 ? 1 : -1)),
      )
    }
    canvas.addEventListener('pointerdown', stopCardEvent, true)
    canvas.addEventListener('click', onClick, true)
    canvas.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      canvas.removeEventListener('pointerdown', stopCardEvent, true)
      canvas.removeEventListener('click', onClick, true)
      canvas.removeEventListener('wheel', onWheel, true)
    }
  }, [gl, raycastCardAt, onOpenQueue, tracks.length])

  /* eslint-disable react-hooks/immutability -- Three.js scene objects are mutable render-loop handles. */
  useFrame((state, delta) => {
    if (!currentTrack || tracks.length === 0) {
      cardsRef.current.forEach((card) => {
        card.mesh.visible = false
      })
      clearShelfFocus()
      hoveredRef.current = -1
      hoverCueRef.current.zoneActive = false
      hoverCueRef.current.exitAt = 0
      return
    }

    const hoverCue = hoverCueRef.current
    const now = performance.now()

    // ---- 悬停判定（对照上游 tickShelfHoverCue + isSideShelfFocusHit）----
    //
    // 触发条件（上游 isSideShelfFocusHit，05-card-interactions.js:13-21）：
    // 本项目卡片常驻（无 shelfVisibility 淡入淡出），等价于上游的
    // `shelfAlwaysVisible()` 分支 —— **只认卡片实际命中**（射线 OR 屏幕
    // AABB，pad 18）。屏幕热区矩形只在上游「卡片半可见的过渡期」作辅助，
    // 卡片常驻时不存在这个状态；此前把热区矩形当主判定，导致右侧大片
    // 空白区域也会召唤相机。
    // UI 之上（模式菜单/控制栏等 DOM）不触发 —— 上游 isPointerOverUi 否决。
    //
    // ★ 跟拍生效后的保持判定（OpenMusic focusCard 的 engaged 分支，
    //   GalaxyFloatingSongCard.tsx:513-518）：`hoveringCenter ||
    //   (shelfFocusEngaged && pointerInShelfZone)` —— 一旦跟拍激活，只看
    //   指针还在不在歌单架**屏幕热区**，不再重判卡片命中。注释原文：
    //   "镜头推近本身会让卡片滑离指针，若这时判定为没悬停就会进入
    //    跟拍→丢失→回位→再跟拍 的抽搐循环"。屏幕热区是固定矩形，
    //   不随相机移动 —— 指针静止在卡片右侧时跟拍稳定保持。
    const slot = orbitCameraState.pointerSlot
    const pointerOverUi = slot != null && isPointerOverUi(slot.x, slot.y)
    const cardHit = slot != null && !pointerOverUi && raycastCardAt(slot.x, slot.y, 18) >= 0
    const shelfFocused = orbitCameraState.focus.active && orbitCameraState.focus.type === 'shelf'
    const inZone =
      slot != null &&
      !pointerOverUi &&
      (cardHit || (shelfFocused && isInShelfHotZone(slot.x, slot.y)))

    // 指针视差推进（上游 11-main-loop.js:346-347）：NDC 目标 → 0.040 低通。
    // 卡片姿态据此做轻微位移/旋转（见 floatingSongCard.applyFloatingSongCardPose）
    // —— 上游「鼠标移动时卡片有 3D 空间感」的来源。
    if (slot != null) {
      shelfPointerParallax.targetX = (slot.x / Math.max(1, window.innerWidth)) * 2 - 1
      shelfPointerParallax.targetY = -(slot.y / Math.max(1, window.innerHeight)) * 2 + 1
    }
    stepShelfPointerParallax()

    if (inZone && !hoverCue.zoneActive) {
      hoverCue.zoneActive = true
      hoverCue.enteredAt = now
      hoverCue.exitAt = 0
    } else if (!inZone && hoverCue.zoneActive) {
      hoverCue.zoneActive = false
      hoverCue.enteredAt = 0
      // 记录离开时刻：退出跟拍要等 120ms（上游 exitTimer 语义），
      // 避免指针擦过热区边缘时镜头来回抖动。
      hoverCue.exitAt = now
    }

    centerSmoothRef.current += (centerTargetRef.current - centerSmoothRef.current) * 0.16
    const centerRounded = Math.round(centerSmoothRef.current)

    // 悬停的是「当前居中那张卡」：上游同样只在中心卡上做跟拍
    hoveredRef.current = inZone ? centerRounded : -1

    // 跟拍：热区内停留超过 260ms 才激活（上游 `setFocusZone` 的 pendingTimer），
    // 一旦激活就锁在固定的跟拍目标上；离开热区后**再等 120ms** 才退出
    //（上游 `exitTimer`，03-focus-cinema-camera.js:246-248）。
    const shouldFocus = hoverCue.zoneActive && now - hoverCue.enteredAt > 260
    // 未在热区内时，退出跟拍还要再等 120ms（上游 exitTimer）
    const shouldExit =
      !shouldFocus &&
      shelfFocused &&
      !hoverCue.zoneActive &&
      hoverCue.exitAt > 0 &&
      now - hoverCue.exitAt > SHELF_EXIT_DELAY_MS
    if (shouldFocus && !shelfFocused) {
      setShelfCameraFocus(true)
    } else if (shouldExit) {
      hoverCue.exitAt = 0
      // 上游退出跟拍只解除 focus，相机由 ease 自动滑回主姿态
      //（03-focus-cinema-camera.js:245-249），**不**请求回正、更不清物体旋转。
      // 此前这里调 `recenterCamera()`（还会顺带清零 gestureRotation），
      // 表现为"扫过卡片再移开，拖拽转过的封面/地形被强行转正"。
      setShelfCameraFocus(false)
    }

    gl.domElement.style.cursor = inZone ? 'pointer' : ''

    const player = usePlayerStore.getState()
    const progress = player.duration > 0 ? Math.max(0, Math.min(1, player.currentTime / player.duration)) : 0
    const bands = readAudioBands()
    const color = accent ?? '#9db8cf'

    tracks.forEach((track, index) => {
      const card = cardsRef.current[index]
      if (!card) return
      // 窗口滑动的滚动补偿：scrollOffset 是"窗口内容位移"的残差，
      // 逐帧缓动回 0 —— 卡片列整体呈现丝滑滚动的过渡
      const scrollOffset = scrollOffsetRef.current
      if (Math.abs(scrollOffset) > 0.0005) {
        scrollOffsetRef.current = scrollOffset * Math.pow(0.88, Math.min(3, Math.max(0.25, delta * 60)))
      } else if (scrollOffset !== 0) {
        scrollOffsetRef.current = 0
      }
      const isCenter = Math.abs(index + scrollOffset - centerSmoothRef.current) < 0.5
      const targetHover = hoveredRef.current === index ? 1 : 0
      hoversRef.current[index] += (targetHover - hoversRef.current[index]) * 0.14
      const distance = applyFloatingSongCardPose(
        card.mesh,
        motionEnabled ? state.clock.elapsedTime : 0,
        index,
        // 滚动补偿进入布局 delta：窗口位移的残差让整列卡片在过渡期
        // 停在"多滚一格"的位置，随偏移缓动归零呈现丝滑滚动
        centerSmoothRef.current + scrollOffset,
        hoversRef.current[index],
      )
      if (!card.mesh.visible) return
      card.mesh.renderOrder = (isCenter ? 300 : 30) + Math.round((6 - Math.min(distance, 6)) * 4)
      const isCurrent = index === currentIdx
      const itemProgress = isCurrent ? progress : 0
      const drawKey = [
        trackKey(track),
        track.title,
        track.artist.join('/'),
        track.album,
        track.cover,
        track.requestedBy ?? '',
        isCenter ? 1 : 0,
        Math.round(itemProgress * 100),
        Math.round((isCurrent ? bands.bass : 0) * 20),
        color,
        hoveredRef.current === index ? 1 : 0,
      ].join('|')
      if (drawKey !== drawKeysRef.current[index]) {
        drawKeysRef.current[index] = drawKey
        const redraw = () => {
          drawFloatingSongCard(
            card,
            {
              title: track.title,
              artist: track.artist.join(' / ') || '未知歌手',
              coverUrl: track.cover ? getProxiedCoverUrl(track.cover) : null,
              // 上游 tag 语义（01-manager-core.js:90）：idx===currentIdx →
              // '正在播放'，否则 '#'+(idx+1)。这里保留"下一首"的中文标注，
              // 相对当前曲目位置计算而不是固定第 1 位。
              tag: isCurrent
                ? '正在播放'
                : currentIdx >= 0 && index === currentIdx + 1
                  ? '下一首'
                  : `#${index + 1}`,
              meta: isCurrent ? track.album || '当前曲目' : `${track.requestedBy ?? '房间成员'} 点歌`,
              progress: itemProgress,
              bass: isCurrent ? bands.bass : 0,
              centered: isCenter,
            },
            color,
            motionEnabled ? state.clock.elapsedTime : 0,
            hoveredRef.current === index,
            redraw,
          )
          card.texture.needsUpdate = true
        }
        redraw()
      }
      const material = card.mesh.material as THREE.MeshBasicMaterial
      material.opacity += ((isCenter ? 0.96 : Math.max(0.22, 1 - distance * 0.3)) - material.opacity) * 0.12
    })
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      {Array.from({ length: cardCount }, (_, index) => (
        <primitive key={tracks[index] ? trackKey(tracks[index]) : index} object={cardsRef.current[index]?.mesh} />
      ))}
    </group>
  )
}

const EMPTY_QUEUE: Track[] = []
