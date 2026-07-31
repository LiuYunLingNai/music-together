export interface AutoNextContext {
  currentUserId: string
  hostId?: string
  playbackKey: string
  sentPlaybackKey: string
}

/** A natural end is authoritative only on the server-elected conductor. */
export function shouldSendAutoNext(context: AutoNextContext): boolean {
  return Boolean(
    context.currentUserId &&
      context.hostId &&
      context.currentUserId === context.hostId &&
      context.playbackKey &&
      context.playbackKey !== context.sentPlaybackKey,
  )
}
