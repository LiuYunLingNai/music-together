import { useEffect, useRef } from 'react'
import { EVENTS, NTP } from '@music-together/shared'
import { useSocketContext } from '@/providers/SocketProvider'
import { recordPing, processPong, resetClockSync, isCalibrated, getMedianRTT } from '@/lib/clockSync'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Runs the NTP clock-sync loop for the lifetime of the socket connection.
 *
 * Phase 1 (calibration): rapid pings every `NTP.INITIAL_INTERVAL_MS` until
 *   `MAX_INITIAL_SAMPLES` are collected.
 * Phase 2 (steady state): pings at the user-configured sync packet interval
 *   to track drift.
 */
export function useClockSync(): void {
  const { socket } = useSocketContext()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const switchedRef = useRef(false)

  useEffect(() => {
    const burstTimers: ReturnType<typeof setTimeout>[] = []

    const sendPing = () => {
      const id = recordPing()
      const rtt = getMedianRTT()
      socket.emit(EVENTS.NTP_PING, { clientPingId: id, lastRttMs: rtt > 0 ? rtt : undefined })
    }

    const startSteadyHeartbeat = () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
      const intervalMs = useSettingsStore.getState().syncPacketIntervalSeconds * 1000
      intervalRef.current = setInterval(sendPing, intervalMs)
    }

    const startFastCalibration = () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
      resetClockSync()
      switchedRef.current = false
      sendPing()
      intervalRef.current = setInterval(sendPing, NTP.INITIAL_INTERVAL_MS)
    }

    const onPong = (data: { clientPingId: number; serverTime: number }) => {
      processPong(data.clientPingId, data.serverTime)
      if (!switchedRef.current && isCalibrated() && intervalRef.current !== null) {
        switchedRef.current = true
        startSteadyHeartbeat()
      }
    }

    const unsubscribeSettings = useSettingsStore.subscribe((state, previousState) => {
      if (state.syncPacketIntervalSeconds === previousState.syncPacketIntervalSeconds) return
      if (switchedRef.current && intervalRef.current !== null) startSteadyHeartbeat()
    })

    const onDisconnect = () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
      intervalRef.current = null
      resetClockSync()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !socket.connected) return
      // Timers and performance clocks can behave differently across sleep and
      // mobile backgrounding. Refresh several samples without discarding the
      // last usable anchor, so an arriving playback action can still schedule.
      for (let i = 0; i < 5; i++) {
        burstTimers.push(setTimeout(sendPing, i * NTP.INITIAL_INTERVAL_MS))
      }
    }

    socket.on(EVENTS.NTP_PONG, onPong)
    socket.on('connect', startFastCalibration)
    socket.on('disconnect', onDisconnect)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (socket.connected) startFastCalibration()

    return () => {
      socket.off(EVENTS.NTP_PONG, onPong)
      socket.off('connect', startFastCalibration)
      socket.off('disconnect', onDisconnect)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribeSettings()
      for (const timer of burstTimers) clearTimeout(timer)
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      resetClockSync()
    }
  }, [socket])
}
