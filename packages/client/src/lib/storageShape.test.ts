// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { storage } from './storage'

afterEach(() => localStorage.clear())

describe('storage 读取形状校验', () => {
  it('损坏的账号 cookie 存储不会抛错，按空列表处理', () => {
    localStorage.setItem('mt-auth-cookies', JSON.stringify({ platform: 'netease' }))
    expect(storage.getAuthCookies()).toEqual([])
    expect(() => storage.upsertAuthCookie('netease', 'x')).not.toThrow()
  })

  it('只保留形状正确的 cookie 项', () => {
    localStorage.setItem('mt-auth-cookies', JSON.stringify([{ platform: 'netease', cookie: 'a' }, null, { platform: 1 }]))
    expect(storage.getAuthCookies()).toEqual([{ platform: 'netease', cookie: 'a' }])
  })

  it('重连凭证字段缺失或类型不对时视为没有凭证', () => {
    localStorage.setItem('mt-rejoin-token', JSON.stringify({ roomId: 'r1', token: 5, expiresAt: Date.now() + 1000 }))
    expect(storage.getRejoinToken('r1')).toBeNull()
  })
})
