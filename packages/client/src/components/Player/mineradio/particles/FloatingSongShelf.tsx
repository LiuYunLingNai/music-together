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
import { SHELF_MAX_RENDER, computeShelfWindow } from './shelfWindow'

/*
 * 渲染预算常量（`SHELF_VISIBLE_RADIUS` / `SHELF_MAX_RENDER`）与窗口推导
 * 已抽到 `./shelfWindow`（带独立回归测试，见 `shelfWindow.test.ts`）。
 * 这里只保留交互相关的常量。
 */

/** 退出跟拍的延迟（上游 `exitTimer`，03-focus-cinema-camera.js:246）。 */
const SHELF_EXIT_DELAY_MS = 120

interface FloatingSongShelfProps {
  accent: string | null
  onOpenQueue: () => void
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

/**
 * 预览使用区宽度（上游 `shelfPreviewUseZoneWidth`，`00-layout-hover.js:74-76`）：
 * `min(820, max(热区宽, 视口宽 × 0.56))` —— 横屏下最多**视口宽的 56%**。
 *
 * ★ 这是「跟拍保持」判定缺的那一半。上游 `isSideShelfFocusHit`
 *   （`05-card-interactions.js:13-21`）的保持分支是
 *   `shelfVisibility > 0.34 && (isShelfClickZone(e) || isShelfPreviewUseZone(e))` ——
 *   即**几何区域**，与卡片网格无关。
 */
function shelfPreviewUseZoneWidth(): number {
  return Math.min(820, Math.max(shelfHotZoneWidth(), window.innerWidth * 0.56))
}

/** 指针是否落在预览使用区内（上游 `isShelfPreviewUseZone`：Y 96 / innerHeight-96）。 */
function isInShelfPreviewUseZone(clientX: number, clientY: number): boolean {
  const edge = shelfPreviewUseZoneWidth()
  return clientX > window.innerWidth - edge && clientY > 96 && clientY < window.innerHeight - 96
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
export function FloatingSongShelf({ accent, onOpenQueue, motionEnabled }: FloatingSongShelfProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const queue = useRoomStore((state) => state.room?.queue ?? EMPTY_QUEUE)
  const { camera, gl } = useThree()
  const cardsRef = useRef<FloatingSongCardMesh[]>([])
  const drawKeysRef = useRef<string[]>([])
  const hoversRef = useRef<number[]>([])
  /**
   * 槽位「封面刚就绪、需要重绘」标记。
   *
   * 与 `drawKeysRef` 平行、按槽位索引。封面加载是异步的，完成时该槽位可能
   * 已被回收给别的歌；因此回调只置位这里，由渲染循环用**当前**的值重绘
   *（详见绘制处 `onCoverReady` 的说明）。
   */
  const coverDirtyRef = useRef<boolean[]>([])
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
   * 歌单架内容 = **整条队列**（上游 `currentItems()` →
   * `playQueue.map(...)`，无上限），中心 = 当前曲目的**绝对队列序号**。
   *
   * 对照上游 `rebuild()`（`04-shelf/01-manager-core.js:382-409`）：
   *   `allItems = currentItems()`；`sig()` 含 `currentIdx`，因此切歌 →
   *   rebuild → `centerTarget = min(len-1, currentIdx)`，并把 `centerSmooth`
   *   **直接吸附**到同一个值（`centerSmooth = centerTarget`，`:397-398`）。
   *
   * ★ 本项目此前的错法：把「渲染条数」当成「可滚动条数」——
   *   `queue.slice(start, start + limit)` 取窗口再夹取滚动范围。后果：
   *     ① 只能滚到这 N 首之内，当前曲目排在窗口外就永远追不上（"只加载
   *        25 首、跟不上当前歌"）；
   *     ② 窗口锚点被 `Math.min(idx - history, len - limit)` 夹在端点，
   *        当前歌贴到窗口首/尾时**一侧完全空**；
   *     ③ 越界滚动时整列空白。
   *   上游的结构是「整条队列 + 只渲染 11 张的回收窗口」，现按此对齐。
   *
   * 当前曲目不在队列时（`removePlayedTracks` 已把它移除）——
   * 虚拟插到队首，保证"正在播放"卡片始终存在（上游无此分支：它的
   * `allItems` 就是队列本身；这是本项目对房间语义的必要补充）。
   */
  const items = useMemo(() => {
    if (!currentTrack) return queue
    const key = trackKey(currentTrack)
    if (queue.some((track) => trackKey(track) === key)) return queue
    return [currentTrack, ...queue]
  }, [currentTrack, queue])

  /** 当前曲目在 `items` 中的**绝对**位置（上游 `currentIdx`）。 */
  const currentIdx = useMemo(() => {
    if (!currentTrack) return -1
    const key = trackKey(currentTrack)
    return items.findIndex((track) => trackKey(track) === key)
  }, [currentTrack, items])

  /**
   * 池大小 = 渲染预算（上游 `SHELF_MAX_RENDER`），**与可滚动范围无关**。
   *
   * 卡片 mesh 是**固定池 + 逐帧重新绑定到队列序号**（上游
   * `syncRenderedWindow` 的 `rebindShelfCard` 等价物）。这样 React 侧
   * 的挂载点是稳定的，窗口滑动时不会再整批卸载/重挂。
   */
  const renderCount = Math.min(SHELF_MAX_RENDER, items.length)

  useEffect(() => {
    while (cardsRef.current.length < renderCount) {
      const card = createFloatingSongCardMesh()
      card.mesh.userData.cardIndex = -1
      cardsRef.current.push(card)
      drawKeysRef.current.push('')
      hoversRef.current.push(0)
      coverDirtyRef.current.push(false)
    }
    while (cardsRef.current.length > renderCount) {
      const card = cardsRef.current.pop()
      if (card) disposeFloatingSongCardMesh(card)
      drawKeysRef.current.pop()
      hoversRef.current.pop()
      coverDirtyRef.current.pop()
    }
    setCardCount(cardsRef.current.length)
  }, [renderCount])

  /**
   * 切歌 → 重新锚定到当前曲目（上游 rebuild 的 `centerTarget/centerSmooth`
   * 吸附语义）。上游是**硬跳**（`centerSmooth = centerTarget`），不做缓动：
   * 歌单架直接跳到当前歌，而不是把整列滚过去。
   *
   * ★ 这里同时**删除了本项目自创的"滚动补偿"**（`scrollOffsetRef`）。
   *   那是为了掩盖"窗口切片换内容"的离散跳变而引入的机制：它把窗口位移量
   *   记成偏移、逐帧缓动回 0。真实后果是大跨度跳变时偏移量极大
   *   （队列 100 首时 ≈ −70），全部卡片一次性超出 ±5.5 剔除距离 ——
   *   整列空白数百毫秒，正是用户报告的"跨度较大时显示空白"。
   *   改为上游结构后不存在"切片换内容"，补偿机制也就不需要了。
   */
  useEffect(() => {
    if (currentIdx < 0) return
    centerTargetRef.current = Math.min(currentIdx, Math.max(0, items.length - 1))
    centerSmoothRef.current = centerTargetRef.current
  }, [currentIdx, items.length])

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
      // React StrictMode 会在开发环境重放 effect。mesh 池销毁后，其并行的
      // 绘制键、悬停状态与封面脏标记也必须同步清空；否则第二次 setup 会把
      // 新槽位追加到旧数组末尾，前 11 个旧 drawKey 可能让新纹理跳过首次绘制
      // 而显示空白。
      drawKeysRef.current = []
      hoversRef.current = []
      coverDirtyRef.current = []
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
    const canInteract = () => items.length > 0

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
      if (!canInteract() || items.length < 2) return
      const hitCard = raycastCardAt(event.clientX, event.clientY) >= 0
      const inWheelZone = isInShelfWheelZone(event.clientX, event.clientY)
      if (!hitCard && !inWheelZone) return
      event.stopImmediatePropagation()
      event.preventDefault()
      // ★ 夹取到**整条队列**（上游 `step()`：`centerTarget = Math.max(0,
      //   Math.min(allItems.length - 1, centerTarget + direction))`，
      //   `01-manager-core.js:679`）。滚到两端即停，不会滚出列表 ——
      //   这是"越界滚动导致显示空白"的另一半修复。
      centerTargetRef.current = Math.max(
        0,
        Math.min(items.length - 1, centerTargetRef.current + (event.deltaY > 0 ? 1 : -1)),
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
  }, [gl, raycastCardAt, onOpenQueue, items.length])

  /* eslint-disable react-hooks/immutability -- Three.js scene objects are mutable render-loop handles. */
  useFrame((state) => {
    if (!currentTrack || items.length === 0) {
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
    // ★ 跟拍生效后的保持判定（上游 `isSideShelfFocusHit`，
    //   `05-card-interactions.js:13-21`）：
    //
    //     保持 = `shelfVisibility > 0.34 && (isShelfClickZone || isShelfPreviewUseZone)`
    //
    //   即**两个屏幕几何区**，与卡片网格**完全无关**。卡片在视觉上会伸出
    //   窄热区之外（横屏热区最宽 360px，而预览使用区可达 **820px / 视口宽
    //   56%**），所以只认窄热区时会出现：
    //     镜头推近 → 卡片滑离指针射线 → cardHit 变假、且指针在窄热区外
    //     → 退出跟拍 → 相机回位 → 卡片又回到指针下 → 再次进入跟拍 …
    //   这正是用户报告的"相机抽搐"。补上预览使用区后，指针只要还在歌单架
    //   那一侧的宽区域内，跟拍就稳定保持。
    //
    //   触发（进入）仍然用卡片命中 —— 与上游一致：触发是"贴在卡上"，
    //   保持是"还在这个区域里"。
    const slot = orbitCameraState.pointerSlot
    const pointerOverUi = slot != null && isPointerOverUi(slot.x, slot.y)
    const cardHit = slot != null && !pointerOverUi && raycastCardAt(slot.x, slot.y, 18) >= 0
    const shelfFocused = orbitCameraState.focus.active && orbitCameraState.focus.type === 'shelf'
    // 保持区 = 热区 ∪ 预览使用区（上游 isSideShelfFocusHit 的宽分支）
    const inShelfHoldZone =
      slot != null &&
      !pointerOverUi &&
      (isInShelfHotZone(slot.x, slot.y) || isInShelfPreviewUseZone(slot.x, slot.y))
    const inZone = cardHit || (shelfFocused && inShelfHoldZone)

    // 指针视差推进（上游 11-main-loop.js:346-347）：NDC 目标 → 0.040 低通。
    // 卡片姿态据此做轻微位移/旋转（见 floatingSongCard.applyFloatingSongCardPose）
    // —— 上游「鼠标移动时卡片有 3D 空间感」的来源。
    if (slot != null) {
      shelfPointerParallax.targetX = (slot.x / Math.max(1, window.innerWidth)) * 2 - 1
      shelfPointerParallax.targetY = -(slot.y / Math.max(1, window.innerHeight)) * 2 + 1
    }
    stepShelfPointerParallax()

    // ★ 迟滞用**变化检测器**，不是"每帧重新计时"。
    //
    //   上游 `setFocusZone`（03-focus-cinema-camera.js:232-261）里，260ms 的
    //   `pendingTimer` 只在 `wantType` **发生变化**时才会重新武装 ——
    //   同一状态下的后续 mousemove 直接 early-return（`if (focusHover.wantType
    //   === type) return`），计时不被重置。OpenMusic 的重写同样是"布尔量变化
    //   才重置开始时刻"（GalaxyFloatingSongCard.tsx:521-526 的
    //   `focusWantRef`/`focusSinceRef` + `>= (focusCard ? 260 : 120)`）。
    //
    //   本项目此前写 `now - enteredAt > 260`，而 `enteredAt` 会随 `inZone`
    //   每次翻转重置。`cardHit` 是逐帧对**活矩阵**射线求交的（卡片自身还在
    //   随 hover 位移/缩放、还带呼吸与滚动补偿），因此它会以亚帧频率抖动，
    //   把计时不断清零 —— 跟拍永远"差一点"才进入或退出，表现为抽动。
    //   改成"只记状态与状态开始时刻"，抖动就不再影响判定。
    if (inZone !== hoverCue.zoneActive) {
      hoverCue.zoneActive = inZone
      hoverCue.enteredAt = now
      // 进入时清掉离开时刻；离开时记录它，供 120ms 退出延迟用
      hoverCue.exitAt = inZone ? 0 : now
    }

    centerSmoothRef.current += (centerTargetRef.current - centerSmoothRef.current) * 0.16
    // 上游有"吸附落定"：`if (abs(centerSmooth - centerTarget) < 0.001) centerSmooth = centerTarget`
    //（01-manager-core.js:748-749），避免无限逼近却永不相等。
    if (Math.abs(centerSmoothRef.current - centerTargetRef.current) < 0.001) {
      centerSmoothRef.current = centerTargetRef.current
    }
    // ★ 两个中心各司其职（与上游一致）：
    //   · 姿态用 `centerSmooth` —— 上游 `placeCard`
    //     （01-manager-core.js:419 `var delta = card.index - centerSmooth`），
    //     决定"卡片画在什么位置"，是缓动后的值；
    //   · 窗口本该用 `round(centerTarget)` —— 上游 `syncRenderedWindow`
    //     （01-manager-core.js:344 `var center = Math.round(centerTarget)`）。
    //
    // ★★ 但这里**刻意改用 `centerSmooth`**（本项目唯一一处与上游的窗口锚点
    //    差异，登记于 HANDOFF §2 D8），原因是上游这两个值会短暂脱节：
    //    滚轮逐格改 `centerTarget`，而 `centerSmooth` 以 0.16/帧追赶，
    //    稳态滞后 ≈ `5.25 × 每帧格数`。窗口若锚在 `centerTarget`、剔除却按
    //    `centerSmooth` 的 ±5.5 判，快速滚动时窗口内**全部**卡片会一次性
    //    超出剔除距离 —— 整列空白。锚在 `centerSmooth` 后，窗口半径 5 恒小于
    //    剔除半径 5.5，**结构上不可能全空**。
    //    静止时二者相等，观感与上游一致；差异只在亚秒级过渡中，且方向是
    //    "更不容易出错"。
    const center = centerSmoothRef.current
    const centerRounded = Math.round(center)

    // 悬停的是「当前**视觉**居中那张卡」：与 placeCard 的 delta 判据同源
    //（上游同样只在中心卡上做跟拍）。存**绝对队列序号**（与 items 同坐标系）。
    hoveredRef.current = inZone ? centerRounded : -1

    // 跟拍：进入要在区域内**连续**停留超过 260ms（上游 `setFocusZone` 的
    // `pendingTimer`）；一旦激活就锁在固定跟拍目标上；离开后**再等 120ms**
    // 才退出（上游 `exitTimer`，03-focus-cinema-camera.js:245-249）。
    const shouldFocus = hoverCue.zoneActive && now - hoverCue.enteredAt > 260
    // 未在区域内时，退出跟拍还要再等 120ms（上游 exitTimer）
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

    // ---- 回收窗口（上游 `syncRenderedWindow`，01-manager-core.js:341-380）----
    //
    // 只有 `SHELF_MAX_RENDER` 个卡片 mesh，逐帧把它们**重新绑定**到围绕中心的
    // 连续队列序号上。窗口推导抽到 `shelfWindow.ts`（有独立回归测试）。
    //
    // 用 `center`（缓动值）而非 `centerTarget` 作锚点 —— 理由见上方 `center`
    // 处的说明（HANDOFF §2 D8）。
    const { start: windowStart, end: windowEnd } = computeShelfWindow(center, items.length)

    cardsRef.current.forEach((card, slotIndex) => {
      const index = windowStart + slotIndex
      if (slotIndex >= SHELF_MAX_RENDER || index > windowEnd) {
        card.mesh.visible = false
        return
      }
      const track = items[index]
      if (!track) {
        card.mesh.visible = false
        return
      }
      // mesh 在窗口内换了队列序号 —— 命中判定要跟着走
      card.mesh.userData.cardIndex = slotIndex
      const isCenter = Math.abs(index - center) < 0.5
      const targetHover = hoveredRef.current === index ? 1 : 0
      hoversRef.current[slotIndex] += (targetHover - hoversRef.current[slotIndex]) * 0.14
      // 传**绝对队列序号** index 与 center —— 上游 placeCard 用的就是
      // `allItems` 上的绝对序号（`delta = card.index - centerSmooth`）。
      const distance = applyFloatingSongCardPose(
        card.mesh,
        motionEnabled ? state.clock.elapsedTime : 0,
        index,
        center,
        hoversRef.current[slotIndex],
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
      if (drawKey !== drawKeysRef.current[slotIndex] || coverDirtyRef.current[slotIndex]) {
        drawKeysRef.current[slotIndex] = drawKey
        coverDirtyRef.current[slotIndex] = false
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
          // ★ 封面异步完成时**只标脏**，由下一帧用**当前**的 item/color/hover
          //   重绘 —— 而不是把本次的绘制闭包回放一遍。
          //
          //   为什么不能回放闭包：`requestCover` 在封面仍处于 `'loading'` 时
          //   会**直接 return 并丢弃新回调**。若本槽位在封面加载期间换了
          //   drawKey（比如卡片变成居中、或切歌），新回调不会被登记，图片
          //   加载完成时触发的仍是**旧**闭包；而旧闭包一旦发现 drawKey 已变
          //   就什么都不画 —— 若此后 drawKey 不再变化（非当前歌卡片 progress
          //   恒为 0），封面就**永远不会出现**（只剩暗色占位块）。
          //   标脏后由渲染循环统一重绘，可同时满足两个目标：
          //   既不用旧数据覆盖新内容，也不会漏掉这次封面就绪。
          () => {
            coverDirtyRef.current[slotIndex] = true
          },
        )
        card.texture.needsUpdate = true
      }
      const material = card.mesh.material as THREE.MeshBasicMaterial
      material.opacity += ((isCenter ? 0.96 : Math.max(0.22, 1 - distance * 0.3)) - material.opacity) * 0.12
    })
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      {/*
        key 必须是**槽位序号**，不能是 trackKey。
        卡片 mesh 是固定池 + 逐帧重绑定（上游 syncRenderedWindow 的
        rebindShelfCard 等价物）；若用 trackKey 作 key，窗口滑动时
        24 个 key 会整批变化，React 会把它们全部卸载重挂 —— 而 mesh 由
        `cardsRef` 持有、且已被 `<primitive>` 交付给 three 管理，重挂会让
        场景树反复摘挂同一批对象（渲染抖动 + 命中判定读到空对象）。
        槽位稳定 ⇒ 挂载点稳定 ⇒ 只有纹理内容随窗口更新。
      */}
      {Array.from({ length: cardCount }, (_, slotIndex) => (
        <primitive key={slotIndex} object={cardsRef.current[slotIndex]?.mesh} />
      ))}
    </group>
  )
}

const EMPTY_QUEUE: Track[] = []
