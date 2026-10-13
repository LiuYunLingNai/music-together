import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { detectHardwareProfile } from '../../stages/RenderPolicy'

export function useFoliaRenderState() {
  const playing = usePlayerStore((s) => s.isPlaying)
  const quality = useSettingsStore((s) => s.visualQuality)
  const reduced = useReducedMotion()
  const [lowSpec] = useState(() => detectHardwareProfile().lowSpec)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return { paused: !playing || !visible, staticMode: !!reduced || quality === 'eco' || lowSpec || !visible }
}
