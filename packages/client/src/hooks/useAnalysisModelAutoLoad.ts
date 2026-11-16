import { useEffect } from 'react'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { loadBeatThisModel, resetBeatThisFailure } from '@/services/analysis/beatThisModel'
import { loadHtdemucsModel, resetHtdemucsFailure } from '@/services/analysis/htdemucsModel'

/** 刷新后按已保存的开关自动装回模型；启动期的临时失败再试两次。 */
const RETRY_DELAYS_MS = [3_000, 8_000]

/**
 * 刷新后按已保存的开关自动装回模型。
 *
 * 设置页的开关只在被点击时触发加载；开关状态是持久化的，页面重开后
 * 不会再有那次点击，功能就会停在「模型尚未加载」。权重走浏览器缓存，
 * 已下载过时这里只是一次本地加载。
 *
 * 空闲卸载之后不主动重载：那是按设计释放显存，下一次真正的分析会自己加载。
 */
export function useAnalysisModelAutoLoad(): void {
  const highPrecisionBeats = useAudioSettingsStore((s) => s.highPrecisionBeats)
  const highPrecisionStems = useAudioSettingsStore((s) => s.highPrecisionStems)

  useEffect(() => {
    if (!highPrecisionBeats) return
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = (): void => {
      if (cancelled) return
      void loadBeatThisModel().catch(() => {
        if (cancelled || attempt >= RETRY_DELAYS_MS.length) return
        timer = setTimeout(() => {
          timer = null
          if (cancelled) return
          attempt += 1
          resetBeatThisFailure()
          run()
        }, RETRY_DELAYS_MS[attempt])
      })
    }
    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [highPrecisionBeats])

  useEffect(() => {
    if (!highPrecisionStems) return
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = (): void => {
      if (cancelled) return
      void loadHtdemucsModel().catch(() => {
        if (cancelled || attempt >= RETRY_DELAYS_MS.length) return
        timer = setTimeout(() => {
          timer = null
          if (cancelled) return
          attempt += 1
          resetHtdemucsFailure()
          run()
        }, RETRY_DELAYS_MS[attempt])
      })
    }
    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [highPrecisionStems])
}
