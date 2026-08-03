import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupRoomRejoinTickets,
  consumeRejoinTicket,
  issueRejoinTicket,
  revokeRejoinTickets,
} from './rejoinTicketService.js'

afterEach(() => {
  cleanupRoomRejoinTickets('ROOM01')
  cleanupRoomRejoinTickets('ROOM02')
  vi.useRealTimers()
})

describe('rejoinTicketService', () => {
  it('issues single-use tickets bound to a room and user', () => {
    const { token } = issueRejoinTicket('ROOM01', 'user-1')

    expect(consumeRejoinTicket(token, 'ROOM02', 'user-1')).toBe(false)
    expect(consumeRejoinTicket(token, 'ROOM01', 'user-2')).toBe(false)
    expect(consumeRejoinTicket(token, 'ROOM01', 'user-1')).toBe(true)
    expect(consumeRejoinTicket(token, 'ROOM01', 'user-1')).toBe(false)
  })

  it('expires tickets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { token, expiresAt } = issueRejoinTicket('ROOM01', 'user-1')
    vi.setSystemTime(expiresAt + 1)

    expect(consumeRejoinTicket(token, 'ROOM01', 'user-1')).toBe(false)
  })

  it('revokes all tickets for one room user', () => {
    const first = issueRejoinTicket('ROOM01', 'user-1').token
    const second = issueRejoinTicket('ROOM01', 'user-1').token
    const other = issueRejoinTicket('ROOM01', 'user-2').token

    revokeRejoinTickets('ROOM01', 'user-1')

    expect(consumeRejoinTicket(first, 'ROOM01', 'user-1')).toBe(false)
    expect(consumeRejoinTicket(second, 'ROOM01', 'user-1')).toBe(false)
    expect(consumeRejoinTicket(other, 'ROOM01', 'user-2')).toBe(true)
  })
})
