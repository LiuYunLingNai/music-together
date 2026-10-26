import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { FoliaModeId } from '../registry'

/**
 * 每首随机歌词样式 —— 上游 `hooks/useRandomVisualizerMode` 的宿主版本。
 *
 * 上游语义：换歌时从随机池里挑一种**不同于当前**的样式；同一首歌只挑一次
 * （StrictMode 重放、歌曲元数据刷新都不重新掷），手动选样式会关掉随机。
 *
 * 上游在 App 层用「当前歌曲 + 池 + 当前样式」驱动；本仓舞台随 `visualStage`
 * 变化而重渲染，所以只在歌曲标识变化时动作，写入走同一份持久化设置。
 */
export function useRandomFoliaMode(songId: string | null) {
  const enabled = useSettingsStore((s) => s.foliaSettings.randomMode)
  const pool = useSettingsStore((s) => s.foliaSettings.randomModePool)
  const mode = useSettingsStore((s) => s.foliaSettings.lyricMode)

  const observedSongRef = useRef<string | null>(null)
  const pendingRef = useRef<{ songId: string | null; from: FoliaModeId } | null>(null)

  useEffect(() => {
    if (!enabled) {
      observedSongRef.current = songId
      pendingRef.current = null
      return
    }
    const changed = songId !== null && observedSongRef.current !== null && observedSongRef.current !== songId
    if (songId !== null) observedSongRef.current = songId

    // 整首歌只挑一次：开随机或改池只替换「不在池里」的样式，换歌才重新掷。
    if (!changed && pool.includes(mode)) {
      pendingRef.current = null
      return
    }
    const pending = pendingRef.current
    if (pending?.songId === songId && pending.from === mode) return
    pendingRef.current = { songId, from: mode }

    const alternatives = pool.filter((id) => id !== mode)
    const candidates = alternatives.length > 0 ? alternatives : pool
    if (candidates.length === 0) return
    const next = candidates[Math.floor(Math.random() * candidates.length)]
    if (next === mode) return
    const store = useSettingsStore.getState()
    store.setVisualStage(next as never)
    store.setFoliaSettings({ lyricMode: next })
  }, [enabled, mode, pool, songId])
}
