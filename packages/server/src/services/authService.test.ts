import { afterEach, describe, expect, it } from 'vitest'
import {
  addCookie,
  cleanupRoom,
  getAllPlatformStatus,
  getAnyCookie,
  getUserAuthStatus,
  getUserCookie,
  hasCookie,
  removeCookie,
} from './authService.js'

afterEach(() => cleanupRoom('ROOM01'))

describe('authService', () => {
  it('keeps cookies room-scoped and prefers the highest VIP level', () => {
    addCookie('ROOM01', 'netease', 'user-1', 'cookie-basic', 'Basic', 0)
    addCookie('ROOM01', 'netease', 'user-2', 'cookie-vip', 'VIP', 11)

    expect(getAnyCookie('netease', 'ROOM01')).toBe('cookie-vip')
    expect(getAnyCookie('netease', 'OTHER')).toBeNull()
    expect(getUserCookie('user-1', 'netease', 'ROOM01')).toBe('cookie-basic')
  })

  it('replaces an existing user cookie instead of duplicating it', () => {
    addCookie('ROOM01', 'tencent', 'user-1', 'old-cookie', 'Old', 0)
    addCookie('ROOM01', 'tencent', 'user-1', 'new-cookie', 'New', 1)

    expect(hasCookie('ROOM01', 'tencent', 'old-cookie')).toBe(false)
    expect(hasCookie('ROOM01', 'tencent', 'new-cookie')).toBe(true)
    expect(getAllPlatformStatus('ROOM01').find((status) => status.platform === 'tencent')).toMatchObject({
      loggedInCount: 1,
      hasVip: true,
      maxVipType: 1,
    })
  })

  it('reports personal status and supports logout', () => {
    addCookie('ROOM01', 'kugou', 'user-1', 'cookie', 'Listener', 2)

    expect(getUserAuthStatus('user-1', 'ROOM01').find((status) => status.platform === 'kugou')).toEqual({
      platform: 'kugou',
      loggedIn: true,
      nickname: 'Listener',
      vipType: 2,
    })
    expect(removeCookie('ROOM01', 'kugou', 'user-1')).toBe(true)
    expect(removeCookie('ROOM01', 'kugou', 'user-1')).toBe(false)
  })
})
