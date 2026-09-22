import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：侧栏安全区退让的**接线**契约（HANDOFF §2 D12）。
 *
 * 这里钉的都是"改错了也不报错、画面只是纹丝不动或悄悄失效"的点：
 *
 *   ① 离轴偏移必须叠加在 `updateProjectionMatrix()` **之后** —— 那个调用会用
 *      `fov/aspect/near/far` 重建投影矩阵，把叠加值覆盖掉。顺序反了就每帧
 *      白改，且**没有任何报错**。
 *   ② 必须用**离轴投影**，不是平移机位 —— 世界空间的平移在不同深度产生的
 *      屏幕位移不等，会让近处的歌曲架让不开或远处的歌词被推歪。
 *   ③ 探针必须真的挂在舞台根内、且用 `--mt-player-safe-*` 作宽度 ——
 *      否则安全区恒为 0，功能静默失效。
 *   ④ 模块级单例（红线 22）必须在卸载时清零。
 */
const HERE = __dirname
const RIG = readFileSync(join(HERE, 'CameraRig.tsx'), 'utf8')
const STAGE = readFileSync(join(HERE, '..', 'MineradioPlayerStage.tsx'), 'utf8')
const SAFE = readFileSync(join(HERE, 'stageSafeArea.ts'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('侧栏退让 · 接线契约', () => {
  it('① 离轴偏移必须叠加在 updateProjectionMatrix **之后**', () => {
    const body = stripComments(RIG)
    const updateAt = body.indexOf('perspective.updateProjectionMatrix()')
    const shiftAt = body.indexOf('stageProjectionShiftX(')
    expect(updateAt, '未找到 updateProjectionMatrix()').toBeGreaterThan(-1)
    expect(shiftAt, 'CameraRig 未应用离轴偏移').toBeGreaterThan(-1)
    expect(shiftAt, '离轴偏移在 updateProjectionMatrix() 之前 —— 会被重建覆盖，每帧白改且不报错').toBeGreaterThan(
      updateAt,
    )
  })

  it('①b 叠加后必须同步逆矩阵（否则射线拾取与画面错位）', () => {
    const body = stripComments(RIG)
    expect(body).toMatch(/projectionMatrixInverse\s*\.copy\([^)]*projectionMatrix\)\s*\.invert\(\)/)
  })

  it('② 必须改 elements[8]（离轴视锥），**不得**平移机位', () => {
    const body = stripComments(RIG)
    expect(body).toMatch(/projectionMatrix\.elements\[8\]/)
    expect(body, '退让不得靠平移机位（世界空间平移在各深度不等）').not.toMatch(
      /position\.addScaledVector\([^)]*axialShift/,
    )
  })

  it('②b 换算与深度/FOV/视口无关：stageProjectionShiftX 只接受一个比例参数', () => {
    const body = stripComments(SAFE)
    const fn = body.match(/export function stageProjectionShiftX[\s\S]*?\n\}/)
    expect(fn, '未找到 stageProjectionShiftX').toBeTruthy()
    // 若签名里出现 radius/fov/aspect 之类，说明又退回"按深度换算"了
    expect(fn![0]).not.toMatch(/radius|fov|aspect|distance/i)
    expect(fn![0]).toMatch(/panFraction/)
  })

  it('③ 舞台必须挂两个探针，且以 --mt-player-safe-* 为宽度', () => {
    const body = stripComments(STAGE)
    expect(body).toMatch(/var\(--mt-player-safe-left/)
    expect(body).toMatch(/var\(--mt-player-safe-right/)
    expect(body, '探针 ref 未接到 DOM').toMatch(/ref=\{leftProbeRef\}/)
    expect(body).toMatch(/ref=\{rightProbeRef\}/)
    expect(body, '未用 ResizeObserver 监听探针').toMatch(/new ResizeObserver\(syncSafeArea\)/)
  })

  it('③b 分母必须用舞台自身宽度，不是 window.innerWidth', () => {
    const body = stripComments(STAGE)
    const call = body.match(/resolveStagePanFraction\([\s\S]*?\)/)
    expect(call, '未找到 resolveStagePanFraction 调用').toBeTruthy()
    expect(call![0]).toMatch(/stageWidth/)
    expect(call![0], '用 window.innerWidth 会因页面外边距把比例算小').not.toMatch(/innerWidth/)
  })

  it('④ 模块级单例必须在卸载时清零（红线 22）', () => {
    const body = stripComments(STAGE)
    expect(body, '未在卸载时清理安全区').toMatch(/clearStageSafeArea\(\)/)
  })

  it('④b 读取端必须每帧推进缓动（不是直接把目标值用上，也不是存进组件 state）', () => {
    const rig = stripComments(RIG)
    // 必须调 stepStageSafeArea（缓动），且**不得**再直接读 panFraction 当位移用
    expect(rig, '未调用缓动推进').toMatch(/stepStageSafeArea\(/)
    expect(rig, '直接读了目标值/当前值，绕过了缓动').not.toMatch(/stageSafeArea\.panFraction/)
  })

  it('★ 退让过渡必须与经典播放器同值同曲线（200ms / ease-out）', () => {
    const body = stripComments(SAFE)
    // 时长 200ms（`.mt-player-content` 的 transition 值）
    expect(body).toMatch(/STAGE_PAN_DURATION_MS = 200\b/)
    // 曲线是 CSS ease-out = cubic-bezier(0, 0, 0.58, 1)
    expect(body, '缓动曲线不是 CSS ease-out').toMatch(/bezierAxis\(u, 0, 0\.58\)/)
    // 减弱动效要立即到位（对应 CSS 的 0.01ms）
    expect(body).toMatch(/STAGE_PAN_REDUCED_MS = 0\.01\b/)
    // 时长由舞台按 matchMedia 设置，而不是写死在缓动里
    expect(stripComments(STAGE)).toMatch(/prefersReducedMotion\(\)/)
  })

  it('★ 目标变化才重启计时（同值重复调用不动）—— 与 CSS transition 语义一致', () => {
    const body = stripComments(SAFE)
    const fn = body.match(/export function publishStagePanFraction[\s\S]*?\n\}/)
    expect(fn, '未找到 publishStagePanFraction').toBeTruthy()
    // 必须有"同值早退"，否则每次 ResizeObserver 回调都会把过渡从头重启
    expect(fn![0], '缺少同值早退 —— ResizeObserver 每次回调都会重启动画').toMatch(
      /if \(next === state\.targetPanFraction\) return/,
    )
    // 中途改目标要从**当前位置**起步，不能跳回 0
    expect(fn![0], '中途反向会跳变').toMatch(/fromPanFraction = state\.panFraction/)
  })
})

/**
 * 回归：歌词**保持居中**、让位由歌单架承担（第三十三轮定案）。
 *
 * 中途曾按上游 `shelfLyricAvoid` 把歌词左移 1.36 —— 那是**错的**：
 * 上游那段位移配合 `fx.lyricCameraLock`（相机锁在歌词上）使用，本项目没有
 * 该开关、相机恒定看向封面，单独套用位移会让歌词离开封面轴心，封面旋转时
 * 明显错位、构图也失去轴心。现改为：
 *   · 歌词恒定居中在封面正上方（不加任何横向避让位移）
 *   · 歌单架右移 0.54 world 让开
 *   · 跟拍注视点跟随歌单架位置（同一常量来源）
 */
const LYRICS = readFileSync(join(HERE, '..', 'lyrics', 'LyricStage.tsx'), 'utf8')
const CARD = readFileSync(join(HERE, 'floatingSongCard.ts'), 'utf8')
const CAM = readFileSync(join(HERE, 'orbitCameraState.ts'), 'utf8')

describe('歌词居中 · 歌单架让位契约', () => {
  it('粒子分支的歌词位置**不得**含任何横向避让位移', () => {
    const body = stripComments(LYRICS)
    const branch = body.match(/if \(coverPose\.active\) \{[\s\S]*?\n {4}\} else \{/)
    expect(branch, '未找到 coverPose.active 分支').toBeTruthy()
    // 位置必须直接取封面位置，不得叠加 axes/SHELF_AVOID 偏移
    expect(branch![0], '歌词被加上了避让位移 —— 会离开封面轴心').not.toMatch(/SHELF_AVOID_X|SHELF_AVOID_Z|axes\.offset/)
    expect(branch![0], '未直接采用封面位置').toMatch(/group\.position\.set\(\s*coverPose\.position\.x/)
  })

  it('★ 歌单架不得回到上游出厂偏移（常驻可见时会压住封面）', () => {
    expect(CARD, '歌单架回到了上游坐标，会再次压住封面').not.toMatch(/SHELF_CENTER = \{ x: -0\.34,/)
    // 当前取值：上游侧栏基准位 + 0 偏移（消掉上游的负偏移，卡片与封面贴着不压住）
    expect(CARD, 'SHELF_CENTER.x 不是当前选定值').toMatch(/SHELF_CENTER = \{ x: 0,/)
  })

  it('★ 跟拍注视点必须与歌单架位置同源，且偏移**分档**（不得硬编码 2.32 / 2.86）', () => {
    const body = stripComments(CAM)
    // 必须由「侧栏基准 x + 用户偏移 − 注视点偏移」推出，与卡片列同源。
    // 偏移自第三十四轮起是**分档函数**（§5.4 C5：竖屏 +0.14 / 窄屏 −0.18 / 宽屏 +0.52），
    // 因为上游的 lookAt.x 只有两档而 sideX 有三档。
    expect(body, 'focus.lookAt.x 应为常量推导而非硬编码').toMatch(
      /shelfSideX\(\)\s*\+\s*SHELF_CENTER\.x\s*-\s*shelfFocusLookAtOffset\(/,
    )
    expect(body, '出现了硬编码的注视点 x').not.toMatch(/lookAt\.set\(2\.(32|86)/)
    // 跟拍档位参数也分档（上游竖屏 theta 0.24 / radius 5.28）
    expect(body, '跟拍档位未分档').toMatch(/shelfFollowTier\(/)
  })

  it('歌单架横向位置必须由 shelfSideX() 提供（与跟拍同源）', () => {
    expect(CARD).toMatch(/shelfSideX\(\)\s*\+\s*SHELF_CENTER\.x/)
  })
})
