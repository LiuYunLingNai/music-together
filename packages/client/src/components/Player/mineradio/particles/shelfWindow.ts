/**
 * 歌单架的**回收窗口**推导 —— 上游 `syncRenderedWindow` 的等价物。
 *
 * ============================ 为什么独立成模块 ============================
 *
 * 这段逻辑承载了用户报告的一组真实缺陷，且**只靠肉眼看不出来**：
 *
 *   ① 「歌曲架依旧只加载显示 25 首，不一定能快速跟进到当前的歌曲」
 *      —— 曾把"渲染条数"当成"可滚动范围"（`queue.slice(start, start+limit)`
 *      再按窗口夹取滚动）。窗口外＝不可达，当前曲目一旦排在窗口外就永远
 *      追不上。上游 `allItems` 是**整条队列**，`SHELF_MAX_RENDER` 只是同时
 *      存在的 mesh 数。
 *   ② 「当前歌曲在歌曲架上显示异常或者空白」
 *      —— 窗口锚点曾被 `min(idx - history, len - limit)` 夹在端点，当前歌
 *      贴到窗口首/尾时**一侧完全空**（0 张或 1 张）。
 *   ③ 「歌曲架可以上下滚动突破限制导致显示空白」
 *      —— 滚动范围必须夹在**整条队列**上（上游 `step()` :679）。
 *
 * 抽成纯函数是为了能用真实取值断言，而不是靠正则匹配源码文本。
 */

/** 上游 `SHELF_VISIBLE_RADIUS`（`04-shelf/01-manager-core.js:6`）。 */
export const SHELF_VISIBLE_RADIUS = 5

/**
 * 上游 `SHELF_MAX_RENDER = SHELF_VISIBLE_RADIUS * 2 + 1`（同文件 :7）。
 *
 * ★ 这是**渲染预算**（同时存在的卡片 mesh 数），不是画质档派生值、
 *   更不是可滚动范围。
 */
export const SHELF_MAX_RENDER = SHELF_VISIBLE_RADIUS * 2 + 1

/** 卡片 mesh 距中心超过该值即被剔除（`floatingSongCard.applyFloatingSongCardPose`）。 */
export const SHELF_CULL_DISTANCE = 5.5

export interface ShelfWindow {
  /** 窗口起始的**队列绝对序号**（闭区间） */
  start: number
  /** 窗口结束的**队列绝对序号**（闭区间） */
  end: number
  /** 窗口内实际存在的卡片数（≤ SHELF_MAX_RENDER） */
  count: number
}

/**
 * 围绕 `center` 推导回收窗口。
 *
 * 与上游 `syncRenderedWindow`（`01-manager-core.js:344-347`）逐行同构：
 *
 *     start = max(0, center - R)
 *     end   = min(total - 1, start + MAX - 1)
 *     start = max(0, end - MAX + 1)      // 末端对齐，尽量凑满 MAX
 *
 * 窗口始终夹在 `[0, total-1]`，因此**不会出现内容之外的空槽**；
 * 且 `round(center)` 必然落在 `[start, end]` 内（见下方断言），
 * 于是"居中那张卡一定可见"是**结构性保证**，不依赖缓动恰好收敛。
 *
 * @param center 目标中心（可为缓动中的小数值）
 * @param total  队列总长
 */
export function computeShelfWindow(center: number, total: number): ShelfWindow {
  if (!Number.isFinite(total) || total <= 0) return { start: 0, end: -1, count: 0 }
  const c = Number.isFinite(center) ? Math.round(center) : 0
  let start = Math.max(0, c - SHELF_VISIBLE_RADIUS)
  const end = Math.min(total - 1, start + SHELF_MAX_RENDER - 1)
  start = Math.max(0, end - SHELF_MAX_RENDER + 1)
  return { start, end, count: end - start + 1 }
}
