/**
 * 断线期间保留播放：连接重新建立后，服务端会再下发一次当前曲目的 PLAYER_PLAY。
 * 若本机仍持有同一首歌的已加载音频，就接回时间线而不是重新加载。
 */

/** 断线超过这个时长仍未恢复，就放弃保留，回到完整重置。 */
export const OFFLINE_GRACE_MS = 120_000
/** 重连后等待服务端回放的有效窗口（含宽限期与加入握手）。 */
const REATTACH_WINDOW_MS = OFFLINE_GRACE_MS + 30_000

let armedAt = 0

export function armPlaybackReattach(): void {
  armedAt = Date.now()
}

/** 只在一次断线之后的第一次 PLAYER_PLAY 上有效。 */
export function consumePlaybackReattach(): boolean {
  const valid = armedAt > 0 && Date.now() - armedAt < REATTACH_WINDOW_MS
  armedAt = 0
  return valid
}

export function disarmPlaybackReattach(): void {
  armedAt = 0
}
