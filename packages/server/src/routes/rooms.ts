import { Router, type Router as RouterType } from 'express'
import { roomShareQrQuerySchema } from '@music-together/shared'
import { roomRepo } from '../repositories/roomRepository.js'
import { isRoomInviteLink, renderRoomInviteQr } from '../services/roomShareService.js'

const router: RouterType = Router()

/** Validate roomId: alphanumeric + _ -, 1-20 chars (matches nanoid urlAlphabet) */
function isValidRoomId(roomId: string): boolean {
  return typeof roomId === 'string' && roomId.length >= 1 && roomId.length <= 20 && /^[A-Za-z0-9_-]+$/.test(roomId)
}

/**
 * GET /api/rooms/:roomId/check
 * Pre-check whether a room exists and whether it requires a password.
 * Used by the client before showing the InteractionGate so that:
 *   - Non-existent rooms redirect immediately (no pointless gate click)
 *   - Password-protected rooms show a password field inside the gate
 */
router.get('/:roomId/check', (req, res) => {
  const { roomId } = req.params
  if (!isValidRoomId(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' })
    return
  }
  const room = roomRepo.get(roomId)

  if (!room) {
    res.status(404).json({ exists: false })
    return
  }

  res.json({
    exists: true,
    hasPassword: room.password !== null,
    name: room.name,
    userCount: room.users.length,
  })
})

/**
 * GET /api/rooms/:roomId/share/qr
 * 为房间邀请链接生成二维码（data URL）。
 * 服务端已有 qrcode 依赖，因此不给前端新增二维码库；
 * 同时只接受指向该房间的 http(s) 邀请链接，避免渲染任意内容。
 */
router.get('/:roomId/share/qr', async (req, res) => {
  const { roomId } = req.params
  if (!isValidRoomId(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' })
    return
  }

  const parsed = roomShareQrQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: '分享链接无效' })
    return
  }

  if (!isRoomInviteLink(parsed.data.link, roomId)) {
    res.status(400).json({ error: '分享链接无效' })
    return
  }

  try {
    const qrimg = await renderRoomInviteQr(parsed.data.link)
    res.json({ qrimg })
  } catch {
    res.status(500).json({ error: '二维码生成失败' })
  }
})

export default router
