import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelScheduledPlay, registerPendingPlayCancel } from './scheduledPlayback'

describe('scheduled playback cancellation bridge', () => {
  let unregister: (() => void) | undefined

  afterEach(() => unregister?.())

  it('keeps the registered cancellation callback reusable', () => {
    const cancel = vi.fn()
    unregister = registerPendingPlayCancel(cancel)

    cancelScheduledPlay()
    cancelScheduledPlay()

    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('removes only the callback owned by its registration', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerPendingPlayCancel(first)
    unregister = registerPendingPlayCancel(second)

    expect(first).toHaveBeenCalledTimes(1)
    unregisterFirst()
    cancelScheduledPlay()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
