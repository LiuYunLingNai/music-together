import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：拍点相机的**分频驱动**与**单点驱动**契约。
 *
 * ============================ 两条真实约束 ============================
 *
 * ① **分频**：上游把实时节拍引擎与整曲自适应放在
 *    `if (audioStepDt > 0)`（`11-main-loop.js:361-362`）**之内**，而包络求值
 *    `updateCinema(dt)` 在门外**每帧**跑（`:617`）。
 *
 *    这**不是**性能优化，而是正确性：引擎的 flux/rise 用"本帧 − 上帧"算，
 *    而本项目音频帧只在 `stepAudioFrame` 时更新（被画质档节流）。若逐帧都调
 *    引擎，未更新帧会拿到**同一个** frame → flux 恒为 0 → 节拍检测失效
 *    （镜头再也不动）。反过来，包络若只在分析帧推进，最短 14ms 的 attack
 *    会在低画质档被采样不足 → 推镜发抖。
 *
 * ② **单点**：`stepBeatCameraFrame` 每帧只能有一个调用者（相机唯一写入者
 *    的延伸，红线 23）。多个消费者各自调用会让包络按调用次数加速衰减。
 */
const BEAT = readFileSync(join(__dirname, 'beatCamera.ts'), 'utf8')
const RIG = readFileSync(join(__dirname, 'CameraRig.tsx'), 'utf8')
const SCENE = readFileSync(join(__dirname, 'ParticleScene.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('拍点相机 · 驱动契约', () => {
  it('① 引擎/自适应 与 ③ 包络 必须是两个入口（分频）', () => {
    const body = stripComments(BEAT)
    // 两个导出各自存在
    expect(body).toMatch(/export function stepBeatCameraAudio\b/)
    expect(body).toMatch(/export function stepBeatCameraFrame\b/)
    // ③（包络）不得调用 ①（引擎）—— 否则每帧都会重算引擎
    const frameFn = body.match(/export function stepBeatCameraFrame[\s\S]*?\n\}/)
    expect(frameFn, 'stepBeatCameraFrame 未找到').toBeTruthy()
    expect(frameFn![0], '包络入口里不得调用引擎（那会让 flux 恒为 0）').not.toMatch(/processRealtimeBeatEngine/)
    expect(frameFn![0]).toMatch(/updateBeatCamera/)
  })

  it('① 引擎必须在音频分析驱动里、且在 stepAudioFrame **之后**（拿本帧新数据）', () => {
    const body = stripComments(SCENE)
    expect(body).toMatch(/stepAudioFrame\(/)
    expect(body, 'ParticleScene 必须调用 stepBeatCameraAudio').toMatch(/stepBeatCameraAudio\(/)
    // 顺序：stepAudioFrame 先于 stepBeatCameraAudio
    const audioAt = body.indexOf('stepAudioFrame(')
    const beatAt = body.indexOf('stepBeatCameraAudio(')
    expect(audioAt).toBeGreaterThan(-1)
    expect(beatAt).toBeGreaterThan(audioAt)
    // 且两者在同一个 useFrame 节流块里（同一 analysisInterval 门控）
    const gateIdx = body.lastIndexOf('analysisInterval) return', beatAt)
    expect(gateIdx, 'stepBeatCameraAudio 不在分析节流门控之内').toBeGreaterThan(-1)
  })

  it('③ 包络在 CameraRig 里每帧调用，且是唯一调用者', () => {
    const rig = stripComments(RIG)
    expect(rig).toMatch(/stepBeatCameraFrame\(/)
    // CameraRig 不得自己调用引擎（那会绕过音频节流）
    expect(rig, 'CameraRig 不得调用 stepBeatCameraAudio').not.toMatch(/stepBeatCameraAudio/)

    // 全仓只有一处 stepBeatCameraFrame 调用点（单点驱动）
    const sceneBody = stripComments(SCENE)
    const rigCalls = (rig.match(/stepBeatCameraFrame\(/g) ?? []).length
    const sceneCalls = (sceneBody.match(/stepBeatCameraFrame\(/g) ?? []).length
    expect(rigCalls, 'CameraRig 里的调用次数').toBe(1)
    expect(sceneCalls, 'ParticleScene 不应调用包络入口').toBe(0)
  })

  it('旧的"常数 + 指数衰减"踢法必须已移除（否则会与事件调度叠加）', () => {
    const rig = stripComments(RIG)
    // 旧的 4 个常数
    expect(rig, '旧的固定 phi 冲击仍在').not.toMatch(/kick\.phi\s*=\s*Math\.max/)
    expect(rig, '旧的固定 radius 冲击仍在').not.toMatch(/kick\.radius\s*=\s*Math\.max/)
    expect(rig, '旧的固定 roll 冲击仍在').not.toMatch(/kick\.roll\s*=\s*Math\.max/)
    // 旧的指数衰减
    expect(rig, '旧的手写指数衰减仍在').not.toMatch(/kick\.punch\s*\*=\s*Math\.max/)
  })

  it('包络合成必须用事件输出的字段名（thetaKick/phiKick/radiusKick/rollKick/punch）', () => {
    const rig = stripComments(RIG)
    expect(rig).toMatch(/kick\.thetaKick/)
    expect(rig).toMatch(/kick\.phiKick/)
    expect(rig).toMatch(/kick\.radiusKick/)
    expect(rig).toMatch(/kick\.rollKick/)
    expect(rig).toMatch(/kick\.punch/)
  })

  it('跟拍时 beatDamp 必须压到 0.55（上游 focus.active 档）', () => {
    const rig = stripComments(RIG)
    expect(rig).toMatch(/focus\.active\s*\?\s*0\.55\s*:\s*1\.0/)
  })

  it('真实切歌必须重置（按 tap 发布代次），且预热窗口按上游设定', () => {
    const body = stripComments(BEAT)
    // 用 tap revision 判定，而不是挂载/卸载
    expect(body).toMatch(/getAudioTapRevision\(\)/)
    expect(body).toMatch(/resetBeatCamera\(currentTime\)/)
    // 预热窗口 = currentTime + 0.48（上游非 DJ）
    expect(body).toMatch(
      /warmupUntil\s*=\s*\(Number\.isFinite\(currentTime\)\s*\?\s*currentTime\s*:\s*0\)\s*\+\s*0\.48/,
    )
  })
})
