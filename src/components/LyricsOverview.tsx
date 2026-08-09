import { Copy, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { findActiveGroup } from '../lyrics/engine'
import { seekPlayback } from '../services/runtime'
import { useAppStore } from '../store/app-store'

const lineText = (words: Array<{ text: string }>) => words.map((word) => word.text).join('').trim()

export function LyricsOverview() {
  const groups = useAppStore((state) => state.lyricGroups)
  const activeIndex = useAppStore((state) => findActiveGroup(state.lyricGroups, state.currentTime * 1000))
  const set = useAppStore((state) => state.set)
  const notify = useAppStore((state) => state.notify)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [activeIndex])
  const copyAll = async () => {
    const text = groups.flatMap((group) => {
      const lines = [lineText(group.main.words)]
      if (group.main.romanLyric) lines.push(group.main.romanLyric)
      if (group.main.translatedLyric) lines.push(group.main.translatedLyric)
      return lines
    }).join('\n')
    await navigator.clipboard.writeText(text)
    notify('歌词已复制')
  }

  return (
    <section className="lyrics-overview-panel" aria-label="歌词总览">
      <header><div><strong>歌词总览</strong><span>点击任意歌词跳转播放</span></div><button className="icon-button" title="复制全部歌词" aria-label="复制全部歌词" onClick={() => void copyAll()}><Copy size={16} /></button><button className="icon-button" title="关闭歌词总览" aria-label="关闭歌词总览" onClick={() => set({ lyricsOverviewOpen: false })}><X size={17} /></button></header>
      <div className="lyrics-overview-list">
        {groups.map((group, index) => (
          <button key={`${group.startTimeMs}-${index}`} ref={index === activeIndex ? activeRef : undefined} className={index === activeIndex ? 'is-active' : ''} onClick={() => seekPlayback(group.startTimeMs / 1000)}>
            <span>{lineText(group.main.words)}</span>
            {group.main.romanLyric && <small>{group.main.romanLyric}</small>}
            {group.main.translatedLyric && <small>{group.main.translatedLyric}</small>}
          </button>
        ))}
      </div>
    </section>
  )
}
