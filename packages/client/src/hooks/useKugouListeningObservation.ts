import { EVENTS, type ListeningObservation } from '@music-together/shared'
import type { Howl } from 'howler'
import { useEffect, type RefObject } from 'react'
import { playbackUrlFor } from '@/lib/playbackSource'
import { listeningEnvironment } from '@/lib/listeningEnvironment'
import { hasLocalListeningOutput } from '@/lib/timeStretch'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSleepTimerStore } from '@/stores/sleepTimerStore'

const breaks = ['pause', 'seeking', 'seeked', 'waiting', 'stalled', 'playing', 'ratechange', 'volumechange', 'emptied']

export function useKugouListeningObservation(
  howlRef: RefObject<Howl | null>,
  soundIdRef: RefObject<number | undefined>,
) {
  const { socket } = useSocketContext()
  useEffect(() => {
    let stop: (() => void) | undefined
    let finalRead: { id: string; read: () => void } | undefined
    const clear = () => {
      stop?.()
      stop = undefined
      finalRead = undefined
    }
    const observe = (request: ListeningObservation | null) => {
      if (request?.final) {
        if (finalRead?.id === request.sessionId) {
          finalRead.read()
          clear()
        }
        return
      }
      clear()
      if (!request) return
      let segment = 0
      let attached: HTMLMediaElement | undefined
      let attachedSoundId: number | undefined
      let terminalSent = false
      const initialTrack = usePlayerStore.getState().currentTrack
      const expectedSrc =
        initialTrack?.source === 'kugou' && initialTrack.id === request.trackId
          ? new URL(playbackUrlFor(initialTrack, request.streamUrl), location.href).href
          : undefined
      const interrupt = () => {
        segment++
      }
      function attach(node?: HTMLMediaElement, soundId?: number) {
        if (node === attached && soundId === attachedSoundId) return
        for (const event of breaks) attached?.removeEventListener(event, interrupt)
        attached?.removeEventListener('ended', ended, true)
        attached = node
        attachedSoundId = soundId
        for (const event of breaks) attached?.addEventListener(event, interrupt)
        attached?.addEventListener('ended', ended, true)
        interrupt()
      }
      const sample = (final = false) => {
        const howl = howlRef.current
        const id = final ? attachedSoundId : soundIdRef.current
        const sound = (howl as { _sounds?: { _id: number; _node?: HTMLMediaElement }[] } | null)?._sounds?.find(
          (s) => s._id === id,
        )
        const node = final ? attached : sound?._node
        const endedNaturally = final && node?.ended === true
        const commonInvalid =
          !node ||
          id === undefined ||
          !socket.connected ||
          !expectedSrc ||
          node.currentSrc !== expectedSrc ||
          node.seeking ||
          node.error ||
          !Number.isFinite(node.duration) ||
          node.duration <= 0 ||
          !Number.isFinite(node.currentTime)
        if (commonInvalid) {
          interrupt()
          return
        }
        if (!final) {
          const { currentTrack, volume } = usePlayerStore.getState()
          const room = useRoomStore.getState().room
          if (
            !howl?.playing(id) ||
            document.visibilityState !== 'visible' ||
            useSleepTimerStore.getState().localHold ||
            !room?.playState.isPlaying ||
            room.automixEnabled ||
            currentTrack?.source !== 'kugou' ||
            currentTrack.id !== request.trackId ||
            currentTrack.streamUrl !== request.streamUrl ||
            node.paused ||
            node.ended ||
            node.muted ||
            node.volume <= 0 ||
            volume <= 0 ||
            node.readyState < node.HAVE_FUTURE_DATA ||
            Math.abs(node.playbackRate - 1) > 0.0051 ||
            !hasLocalListeningOutput(node)
          ) {
            interrupt()
            return
          }
          attach(node, id)
        } else if (!endedNaturally && node.readyState < node.HAVE_CURRENT_DATA) {
          return
        }
        if (endedNaturally) {
          if (terminalSent) return
          terminalSent = true
        }
        const durationMs = Math.round(node.duration * 1000)
        socket.emit(EVENTS.PLAYER_LISTENING_SAMPLE, {
          sessionId: request.sessionId,
          segment,
          positionMs: endedNaturally ? durationMs : Math.round(node.currentTime * 1000),
          durationMs,
          environment: listeningEnvironment(),
          ...(final ? { final: true as const } : {}),
          ...(endedNaturally ? { naturallyEnded: true as const } : {}),
        })
      }
      function ended(event: Event) {
        const node = event.currentTarget as HTMLMediaElement
        if (node !== attached) attach(node)
        sample(true)
        interrupt()
      }
      document.addEventListener('visibilitychange', interrupt)
      finalRead = { id: request.sessionId, read: () => sample(true) }
      const timer = setInterval(sample, 1_000)
      stop = () => {
        clearInterval(timer)
        attached?.removeEventListener('ended', ended, true)
        attach()
        document.removeEventListener('visibilitychange', interrupt)
      }
      sample()
    }
    socket.on(EVENTS.PLAYER_LISTENING_OBSERVE, observe)
    socket.on('disconnect', clear)
    return () => {
      socket.off(EVENTS.PLAYER_LISTENING_OBSERVE, observe)
      socket.off('disconnect', clear)
      clear()
    }
  }, [socket, howlRef, soundIdRef])
}
