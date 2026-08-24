import QRCode from 'qrcode'

const MAX_QR_LINK_LENGTH = 500

/**
 * 校验分享链接必须是指向目标房间的 http(s) 邀请链接。
 * 避免二维码接口被用来渲染任意来源提供的内容。
 */
export function isRoomInviteLink(link: string, roomId: string): boolean {
  if (typeof link !== 'string' || link.length === 0 || link.length > MAX_QR_LINK_LENGTH) return false

  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    return false
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.hash !== '') return false

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0)
  if (segments.at(-1) === 'join') {
    return parsed.searchParams.get('ROMMid') === roomId
  }
  if (parsed.search !== '') return false
  if (segments.length < 2) return false

  return segments[segments.length - 2] === 'room' && decodeURIComponent(segments[segments.length - 1]) === roomId
}

export function renderRoomInviteQr(link: string): Promise<string> {
  return QRCode.toDataURL(link, { margin: 1, width: 320 })
}
