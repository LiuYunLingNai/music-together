import { describe, expect, it } from 'vitest'
import { rejoinTicketExpiry } from './rejoinTicket.js'

describe('rejoinTicketExpiry', () => {
  it('有 ttlMs 时从收到时刻起算，不受本机时钟差影响', () => {
    expect(rejoinTicketExpiry({ expiresAt: 1, ttlMs: 60_000 }, 1_000)).toBe(61_000)
  })
  it('缺少 ttlMs 时退回 expiresAt', () => {
    expect(rejoinTicketExpiry({ expiresAt: 5_000 }, 1_000)).toBe(5_000)
  })
})
