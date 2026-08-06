import type { Track } from '../domain/types'

interface AudioCallbacks {
  onTime: (currentTime: number, duration: number, buffered: number) => void
  onPlaying: (playing: boolean) => void
  onError: (message: string) => void
  onEnded: () => void
}

export class DesktopAudioPlayer {
  private audio = new Audio()
  private animationFrame = 0
  private pendingSeek = 0
  private pendingPlay = false

  constructor(private callbacks: AudioCallbacks) {
    this.audio.preload = 'auto'
    this.audio.addEventListener('loadedmetadata', () => {
      this.audio.currentTime = Math.min(this.pendingSeek, this.audio.duration || this.pendingSeek)
      this.emitTime()
      if (this.pendingPlay) void this.play()
    })
    this.audio.addEventListener('playing', () => {
      this.callbacks.onPlaying(true)
      this.startClock()
    })
    this.audio.addEventListener('pause', () => {
      this.callbacks.onPlaying(false)
      cancelAnimationFrame(this.animationFrame)
    })
    this.audio.addEventListener('ended', () => {
      this.callbacks.onPlaying(false)
      this.callbacks.onEnded()
    })
    this.audio.addEventListener('error', () => this.callbacks.onError('音频加载失败，请检查音源或服务器代理'))
    this.audio.addEventListener('progress', () => this.emitTime())
  }

  load(track: Track, serverUrl: string, roomId: string, startAt = 0, playing = false): void {
    if (!track.streamUrl) {
      this.callbacks.onError('服务器尚未提供可播放地址')
      return
    }
    this.pendingSeek = Math.max(0, startAt)
    this.pendingPlay = playing
    this.audio.src = this.resolveStreamUrl(track, serverUrl, roomId)
    this.audio.load()
  }

  async play(): Promise<void> {
    this.pendingPlay = true
    try {
      await this.audio.play()
    } catch {
      this.callbacks.onError('系统阻止了自动播放，请点击播放按钮继续')
    }
  }

  pause(at?: number): void {
    this.pendingPlay = false
    if (typeof at === 'number') this.seek(at)
    this.audio.pause()
  }

  seek(seconds: number): void {
    this.pendingSeek = Math.max(0, seconds)
    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) this.audio.currentTime = this.pendingSeek
    this.emitTime()
  }

  setVolume(value: number): void {
    this.audio.volume = Math.min(1, Math.max(0, value))
  }

  setPlaybackRate(value: number): void {
    this.audio.playbackRate = Math.min(1.01, Math.max(0.99, value))
  }

  get currentTime(): number {
    return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : this.pendingSeek
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame)
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  private startClock(): void {
    cancelAnimationFrame(this.animationFrame)
    const update = () => {
      this.emitTime()
      if (!this.audio.paused) this.animationFrame = requestAnimationFrame(update)
    }
    this.animationFrame = requestAnimationFrame(update)
  }

  private emitTime(): void {
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0
    let buffered = 0
    if (duration > 0 && this.audio.buffered.length) buffered = this.audio.buffered.end(this.audio.buffered.length - 1) / duration
    this.callbacks.onTime(this.currentTime, duration, buffered)
  }

  private resolveStreamUrl(track: Track, serverUrl: string, roomId: string): string {
    if (track.source === 'bilibili') {
      const params = new URLSearchParams({ url: track.streamUrl!, bvid: track.urlId, roomId })
      return `${serverUrl}/api/music/bilibili-audio-proxy?${params}`
    }
    if (track.source === 'kugou' || track.source === 'kugou_concept' || track.requiresServerProxy) {
      return `${serverUrl}/api/music/kugou-audio-proxy?url=${encodeURIComponent(track.streamUrl!)}`
    }
    return track.streamUrl!
  }
}
