import { useSettingsStore } from '@/stores/settingsStore'
import { canRenderFogToFloat, NebbiaProgramBuild } from './nebbiaPrograms'
import { normalizeNebbiaTuning } from './nebbiaTuning'

// 启动时在空闲里预先编雾笺的着色器（上游 entry 的 prewarm）。在一个不上屏的 WebGL2 上下文里按运行时
// 同样的编法编一遍，编好就丢掉上下文：GPU 进程留着编好的程序，雾笺真正挂上时链接直接命中。

const POLL_MS = 100
/** 最多等这么久：还编不完（驱动卡住之类）就放弃，运行时自己再编。 */
const GIVE_UP_MS = 30_000

let started = false

/** 预热一次（同一个窗口里只做一次）；没有 WebGL2 或编不过时什么都不做，运行时照常处理。 */
export const warmNebbiaShaders = (): void => {
    if (started || typeof document === 'undefined') return
    started = true
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    if (!gl) {
        console.info('[Nebbia] shader warm-up skipped: no WebGL2')
        return
    }
    if (!gl.getExtension('KHR_parallel_shader_compile')) {
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        console.info('[Nebbia] shader warm-up skipped: no KHR_parallel_shader_compile')
        return
    }
    const startedAt = performance.now()
    // 窗外是哪套场景、玻璃是哪种是着色器变体：按保存的那套编（宿主调参存在 foliaSettings.tunings.nebbia）。
    const saved = normalizeNebbiaTuning(useSettingsStore.getState().foliaSettings.tunings.nebbia)
    const scene = saved.behind === 'aquarium' ? 'aquarium' : 'night'
    const build = new NebbiaProgramBuild(gl, canRenderFogToFloat(gl), scene, saved.glass)
    const finish = (outcome: string, error?: unknown) => {
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        const ms = Math.round(performance.now() - startedAt)
        if (error) console.warn(`[Nebbia] shader warm-up ${outcome} after ${ms} ms`, error)
        else console.info(`[Nebbia] shader warm-up ${outcome} in ${ms} ms`)
    }
    const poll = () => {
        if (gl.isContextLost()) return finish('lost the context')
        try {
            if (build.poll()) return finish('done')
        } catch (error) {
            return finish('failed', error)
        }
        if (performance.now() - startedAt > GIVE_UP_MS) return finish('gave up')
        window.setTimeout(poll, POLL_MS)
    }
    window.setTimeout(poll, POLL_MS)
}
