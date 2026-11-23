import { EVENTS, type LocalListeningSource, type SoloSettlement } from '@music-together/shared'
import { useEffect } from 'react'
import {
  LocalListeningProgress,
  pageListening,
  type ListeningDeck,
  type LocalOutput,
} from '@/lib/localListeningProgress'
import { playbackUrlFor } from '@/lib/playbackSource'
import { listeningEnvironment } from '@/lib/listeningEnvironment'
import { hasLocalListeningOutput } from '@/lib/timeStretch'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSleepTimerStore } from '@/stores/sleepTimerStore'

const breaks = ['playing', 'waiting', 'stalled', 'emptied', 'seeking', 'seeked', 'ratechange', 'volumechange']

function matches(deck: ListeningDeck, source: LocalListeningSource): boolean {
  const { track, node } = deck
  return (
    track.source === 'kugou' &&
    track.id === source.trackId &&
    track.streamUrl === source.streamUrl &&
    node.currentSrc === new URL(playbackUrlFor(track, source.streamUrl), location.href).href &&
    Number.isFinite(node.duration) &&
    Math.abs(node.duration - track.duration) <= 1.5
  )
}

export function useLocalListeningProgress(readOutput: () => LocalOutput) {
  const { socket } = useSocketContext()
  useEffect(() => {
    let requested: LocalListeningSource | null = null
    let active:
      | { deck: object; source: LocalListeningSource; clock: LocalListeningProgress; segment: number; sentAt: number }
      | undefined
    let previous: number | null = null
    let previousSession: string | undefined
    let verifiedPrevious: number | undefined
    let earlyReceipt: SoloSettlement | undefined
    let revision = -1
    let lastNode: HTMLMediaElement | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const nodes = new Set<HTMLMediaElement>()
    const interrupt = () => {
      if (active && lastNode) {
        active.clock.interrupt()
        active.segment++
        active.sentAt = -Infinity
      }
      lastNode = undefined
    }
    const publish = () =>
      pageListening.publish({
        seconds: Math.floor((active?.clock.totalMs ?? 0) / 1000),
        previous,
        ...(verifiedPrevious === undefined ? {} : { verifiedPrevious }),
      })
    const receive = (receipt: SoloSettlement) => {
      if (receipt.sessionId === previousSession) {
        verifiedPrevious = Math.floor(receipt.milliseconds / 1000)
        publish()
      } else if (receipt.sessionId === active?.source.soloSessionId) earlyReceipt = receipt
    }

    const poll = (terminal?: HTMLMediaElement) => {
      if (!requested) return
      const room = useRoomStore.getState().room
      if (
        !socket.connected ||
        room?.id !== requested.roomId ||
        !room.playState.isPlaying ||
        document.visibilityState !== 'visible' ||
        useSleepTimerStore.getState().localHold ||
        usePlayerStore.getState().volume <= 0
      ) {
        interrupt()
        return
      }
      const output = readOutput()
      if (revision !== output.revision) {
        interrupt()
        revision = output.revision
      }
      for (const node of nodes) if (!output.decks.some((d) => d.node === node)) detach(node)
      for (const { node } of output.decks) if (!nodes.has(node)) attach(node)
      const sounding = output.decks.filter(
        ({ node, playing }) =>
          ((playing && !node.paused && !node.ended) || (node === terminal && node === lastNode && node.ended)) &&
          !node.muted &&
          node.volume > 0 &&
          !node.error &&
          hasLocalListeningOutput(node),
      )
      if (output.stems || sounding.length !== 1) return interrupt()
      const deck = sounding[0]
      const { node } = deck
      if (
        node.seeking ||
        node.readyState < (node === terminal ? node.HAVE_CURRENT_DATA : node.HAVE_FUTURE_DATA) ||
        !Number.isFinite(node.playbackRate) ||
        Math.abs(node.playbackRate - 1) > 0.0051
      )
        return interrupt()
      if (
        active?.deck === deck.instance &&
        active.source.trackId === requested.trackId &&
        active.source.soloSessionId !== requested.soloSessionId &&
        matches(deck, requested)
      )
        return interrupt()
      if (active?.deck !== deck.instance || !matches(deck, active.source)) {
        if (!matches(deck, requested)) return interrupt()
        if (active) {
          previous = Math.floor(active.clock.totalMs / 1000)
          previousSession = active.source.soloSessionId
          verifiedPrevious =
            earlyReceipt && earlyReceipt.sessionId === previousSession
              ? Math.floor(earlyReceipt.milliseconds / 1000)
              : undefined
          earlyReceipt = undefined
          if (previousSession) socket.emit(EVENTS.PLAYER_SOLO_PROGRESS, { kind: 'end', sessionId: previousSession })
        }
        active = {
          deck: deck.instance,
          source: requested,
          clock: new LocalListeningProgress(),
          segment: 0,
          sentAt: -Infinity,
        }
      }
      lastNode = node
      const now = performance.now()
      const positionMs = Math.round(node.currentTime * 1000)
      const durationMs = Math.round(node.duration * 1000)
      active.clock.sample(now, positionMs)
      const sessionId = active.source.soloSessionId
      if (
        sessionId &&
        Number.isFinite(positionMs) &&
        positionMs >= 0 &&
        positionMs <= durationMs &&
        (now - active.sentAt >= 1000 || node === terminal)
      ) {
        active.sentAt = now
        socket.emit(EVENTS.PLAYER_SOLO_PROGRESS, {
          kind: 'sample',
          sessionId,
          segment: active.segment,
          positionMs,
          durationMs,
          environment: listeningEnvironment(),
        })
      }
      publish()
    }
    const tick = () => poll()
    const update = (event: Event) => {
      const node = event.currentTarget as HTMLMediaElement
      poll(node.ended ? node : undefined)
    }
    const ended = (event: Event) => {
      update(event)
      interrupt()
    }
    function attach(node: HTMLMediaElement) {
      nodes.add(node)
      for (const event of breaks) node.addEventListener(event, interrupt)
      node.addEventListener('timeupdate', update)
      node.addEventListener('pause', ended, true)
      node.addEventListener('ended', ended, true)
    }
    function detach(node: HTMLMediaElement) {
      nodes.delete(node)
      for (const event of breaks) node.removeEventListener(event, interrupt)
      node.removeEventListener('timeupdate', update)
      node.removeEventListener('pause', ended, true)
      node.removeEventListener('ended', ended, true)
    }
    const clear = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      for (const node of nodes) detach(node)
      document.removeEventListener('visibilitychange', interrupt)
      requested = null
      active = undefined
      previous = null
      lastNode = undefined
      revision = -1
      previousSession = undefined
      verifiedPrevious = undefined
      earlyReceipt = undefined
      pageListening.publish(null)
    }
    const bind = (source: LocalListeningSource | null) => {
      if (!source) return clear()
      if (requested && requested.roomId !== source.roomId) clear()
      requested = source
      if (timer === undefined) {
        document.addEventListener('visibilitychange', interrupt)
        timer = setInterval(tick, 1000)
      }
      tick()
    }
    const unsubscribe = useRoomStore.subscribe((state, prev) => {
      if (prev.room?.id && prev.room.id !== state.room?.id) clear()
    })
    socket.on(EVENTS.PLAYER_LOCAL_LISTENING_SOURCE, bind)
    socket.on(EVENTS.PLAYER_SOLO_SETTLED, receive)
    socket.on('disconnect', clear)
    return () => {
      socket.off(EVENTS.PLAYER_LOCAL_LISTENING_SOURCE, bind)
      socket.off(EVENTS.PLAYER_SOLO_SETTLED, receive)
      socket.off('disconnect', clear)
      unsubscribe()
      clear()
    }
  }, [readOutput, socket])
}
