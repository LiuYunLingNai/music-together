/**
 * 歌单架卡片命中判定的共享注册表。
 *
 * 上游在 `00-pointer-cover-particles.js` 的 dblclick 处理里直接调
 * `shelfManager.raycastCards(rc)`：**双击命中卡片时跳过相机回正**。
 *
 * 本项目里 dblclick 监听在 `CameraRig`，而卡片 mesh 在 `FloatingSongShelf`，
 * 两者是兄弟组件。由于同一 DOM 节点上的监听器按注册顺序触发（CameraRig
 * 先挂载、先注册），歌单架无法用捕获阶段拦截来阻止 CameraRig 的回正，
 * 因此沿用本项目「模块级单例」的既有模式：歌单架把自己的命中判定
 * 注册进来，CameraRig 在回正前查询。
 */

type ShelfHitTester = (clientX: number, clientY: number) => boolean

let tester: ShelfHitTester | null = null

/** 由 `FloatingSongShelf` 在挂载时注册，卸载时传 null 注销。 */
export function registerShelfHitTester(next: ShelfHitTester | null): void {
  tester = next
}

/** 双击回正前查询：指针是否压在可见卡片上。 */
export function isPointerOverShelfCard(clientX: number, clientY: number): boolean {
  return tester ? tester(clientX, clientY) : false
}
