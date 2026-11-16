/** 重连凭证的本地到期时间：优先按收到时刻加有效时长，避免受本机与服务器时钟差影响。 */
export function rejoinTicketExpiry(data: { expiresAt: number; ttlMs?: number }, receivedAt = Date.now()): number {
  return typeof data.ttlMs === 'number' && data.ttlMs > 0 ? receivedAt + data.ttlMs : data.expiresAt
}
