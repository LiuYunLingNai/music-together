import { LocateFixed, Music2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LyricLine, LyricWord } from '../domain/types'
import { buildInterludes, findActiveGroup, findActiveInterlude, wordProgress } from '../lyrics/engine'
import { seekPlayback } from '../services/runtime'
import { useAppStore } from '../store/app-store'

export function LyricsView() {
  const groups = useAppStore((state) => state.lyricGroups)
  const currentTime = useAppStore((state) => state.currentTime)
  const loading = useAppStore((state) => state.lyricsLoading)
  const error = useAppStore((state) => state.lyricsError)
  const room = useAppStore((state) => state.room)!
  const settings = useAppStore((state) => state.lyricSettings)
  const [offset, setOffset] = useState(0)
  const [manual, setManual] = useState(false)
  const manualTimer = useRef(0)
  const hasFocused = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([])
  const positionMs = currentTime * 1000 - offset
  const activeIndex = findActiveGroup(groups, positionMs)
  const interludes = useMemo(() => buildInterludes(groups), [groups])
  const activeInterlude = findActiveInterlude(interludes, positionMs)

  useEffect(() => {
    const track = room.currentTrack
    if (!track) return
    const key = `${track.source}:${track.metadataSource ?? ''}:${track.lyricId ?? track.sourceId}`
    setOffset(Number(localStorage.getItem(`music-together-desktop:lyric-offset:${key}`) ?? 0))
    const handler = (event: Event) => setOffset((event as CustomEvent<number>).detail)
    window.addEventListener('lyric-offset-change', handler)
    return () => window.removeEventListener('lyric-offset-change', handler)
  }, [room.currentTrack])

  useEffect(() => {
    if (manual || activeIndex < 0) return
    scrollLyricLine(scrollRef.current, lineRefs.current[activeIndex], settings.alignAnchor, settings.alignPosition, settings.animation && hasFocused.current ? 'smooth' : 'auto')
    hasFocused.current = true
  }, [activeIndex, manual, settings.alignAnchor, settings.alignPosition, settings.animation])

  const markManual = () => {
    setManual(true)
    window.clearTimeout(manualTimer.current)
    manualTimer.current = window.setTimeout(() => setManual(false), 3_500)
  }

  const restoreFocus = () => {
    setManual(false)
    scrollLyricLine(scrollRef.current, lineRefs.current[activeIndex], settings.alignAnchor, settings.alignPosition, settings.animation ? 'smooth' : 'auto')
  }

  if (loading) return <div className="lyrics-state"><span className="loading-bars"><i /><i /><i /></span><strong>正在整理歌词时间轴</strong></div>
  if (error || !groups.length) return <div className="lyrics-state"><Music2 size={28} /><strong>{error || '这首歌暂无歌词'}</strong><span>音乐仍会继续播放</span></div>

  return (
    <div
      className={`lyrics-wrap ${settings.animation ? '' : 'lyrics--no-animation'} ${settings.blur ? 'lyrics--blur' : ''} ${settings.scale ? '' : 'lyrics--no-scale'}`}
      style={{
        '--lyric-anchor-position': `${settings.alignPosition * 100}%`,
        '--lyric-font-size': settings.fontSize / 100,
        '--lyric-font-weight': settings.fontWeight,
        '--lyric-translation-size': settings.translationFontSize / 100,
        '--lyric-roman-size': settings.romanFontSize / 100,
      } as CSSProperties}
    >
      <div ref={scrollRef} className="lyrics-scroll" onWheel={markManual} onPointerDown={markManual}>
        <div className="lyrics-spacer" />
        {groups.map((group, index) => (
          <button
            key={`${group.startTimeMs}-${index}`}
            ref={(element) => { lineRefs.current[index] = element }}
            className={`lyric-line ${index === activeIndex ? 'is-active' : ''} ${index < activeIndex ? 'is-past' : ''} ${group.main.isDuet ? 'is-duet' : ''}`}
            onClick={() => {
              seekPlayback(Math.max(0, (group.main.words[0]?.startTimeMs ?? group.startTimeMs) / 1000 + offset / 1000))
              setManual(false)
            }}
          >
            <KaraokeLine line={group.main} positionMs={positionMs} active={index === activeIndex} />
            {group.background && <div className="lyric-background"><KaraokeLine line={group.background} positionMs={positionMs} active={index === activeIndex} /></div>}
          </button>
        ))}
        <div className="lyrics-spacer" />
      </div>
      {manual && <button className="return-focus" onClick={restoreFocus}><LocateFixed size={15} />回到当前歌词</button>}
      {activeInterlude && (
        <div className="interlude" style={{ '--interlude-progress': `${Math.max(0, Math.min(1, (positionMs - activeInterlude.startTimeMs) / (activeInterlude.endTimeMs - activeInterlude.startTimeMs))) * 100}%` } as CSSProperties}>
          <span /><span /><span />
        </div>
      )}
    </div>
  )
}

function scrollLyricLine(
  container: HTMLDivElement | null,
  line: HTMLButtonElement | null,
  anchor: 'top' | 'center' | 'bottom',
  position: number,
  behavior: ScrollBehavior,
): void {
  if (!container || !line) return
  const itemAnchor = line.offsetTop + (anchor === 'top' ? 0 : anchor === 'bottom' ? line.offsetHeight : line.offsetHeight / 2)
  const viewportAnchor = container.clientHeight * Math.min(1, Math.max(0, position))
  container.scrollTo({ top: Math.max(0, itemAnchor - viewportAnchor), behavior })
}

function KaraokeLine({ line, positionMs, active }: { line: LyricLine; positionMs: number; active: boolean }) {
  return (
    <div className="karaoke-line">
      <div className="karaoke-main">
        {line.words.map((word, index) => <KaraokeWord key={`${word.startTimeMs}-${index}`} word={word} positionMs={positionMs} active={active} />)}
      </div>
      {line.romanLyric && <div className="lyric-roman">{line.romanLyric}</div>}
      {line.translatedLyric && <div className="lyric-translation">{line.translatedLyric}</div>}
    </div>
  )
}

function KaraokeWord({ word, positionMs, active }: { word: LyricWord; positionMs: number; active: boolean }) {
  const progress = active ? wordProgress(word, positionMs) : positionMs >= word.endTimeMs ? 1 : 0
  const emphasized = active && word.endTimeMs - word.startTimeMs >= 1_000 && (Array.from(word.text.trim()).length <= 7)
  const effect = emphasized ? Math.sin(Math.PI * progress) : 0
  const style = { '--word-reveal': `${progress * 100}%`, '--word-lift': `${effect * 0.035 + 1}` } as CSSProperties
  return (
    <span className="karaoke-word" style={style}>
      {word.ruby?.length ? <ruby>{word.text}<rt>{word.ruby.map((part) => part.text).join('')}</rt></ruby> : word.text}
      <span className="karaoke-word__fill" aria-hidden="true">{word.ruby?.length ? <ruby>{word.text}<rt>{word.ruby.map((part) => part.text).join('')}</rt></ruby> : word.text}</span>
    </span>
  )
}
