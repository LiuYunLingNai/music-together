import { compileLyricLineRules } from '@/lib/lyrics/lyricLineRules'
import { useSettingsStore } from '@/stores/settingsStore'
import { useMemo } from 'react'

export function useLyricLineFilter(): (text: string) => boolean {
  const rules = useSettingsStore((state) => state.lyricLineRules)
  return useMemo(() => compileLyricLineRules(rules), [rules])
}
