/**
 * 断网保护：当前歌曲的整曲字节，只保留一首。
 * 断线且音频停滞时，播放侧用它的本地副本继续播放，不依赖网络和服务端。
 */

let held: { trackId: string; bytes: ArrayBuffer } | null = null

export function holdOfflineBuffer(trackId: string, bytes: ArrayBuffer): void {
  held = { trackId, bytes }
}

export function hasOfflineBuffer(trackId: string): boolean {
  return held?.trackId === trackId
}

/** 返回副本：解码或 Blob 化都不应影响被保留的原件。 */
export function takeOfflineBufferCopy(trackId: string): ArrayBuffer | null {
  return held?.trackId === trackId ? held.bytes.slice(0) : null
}

export function clearOfflineBuffer(): void {
  held = null
}
