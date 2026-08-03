let stopActivePlayback: (() => void) | null = null

export function registerActivePlaybackStop(stop: () => void): () => void {
  stopActivePlayback = stop
  return () => {
    if (stopActivePlayback === stop) stopActivePlayback = null
  }
}

export function stopActiveAudio(): void {
  stopActivePlayback?.()
}
