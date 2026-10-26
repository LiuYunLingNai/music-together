import { createContext, useContext } from 'react'
import type { MotionValue } from 'motion/react'
import type { AudioBands } from '../upstream/types'

export interface FoliaAudioSignals {
  audioPower: MotionValue<number>
  audioBands: AudioBands
}

/**
 * 舞台已经持有的音频信号。
 *
 * 预览若自己调用 `useFoliaAudio`，会和主舞台争用 `AudioAnalyser` 的模块级单例
 * （后挂载的一方接管接线，卸载时又拆掉对方的节点）。因此音频只由舞台推进，
 * 预览通过这个 context 只读转发；没有 provider 时预览使用静态值。
 */
const FoliaAudioContext = createContext<FoliaAudioSignals | null>(null)
export const FoliaAudioProvider = FoliaAudioContext.Provider
export const useFoliaAudioSignals = () => useContext(FoliaAudioContext)
