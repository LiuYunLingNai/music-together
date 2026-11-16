export interface AudioEffectBranch {
  set: (amount: number) => void
  dispose: () => void
}

const RELEASE_DELAY_MS = 800

export const createReleaseTimer = () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    cancel: (): void => {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
    schedule: (release: () => void): void => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        release()
      }, RELEASE_DELAY_MS)
    },
  }
}
