import { EVENTS, QR_STATUS } from '@music-together/shared'
import type { MusicSource } from '@music-together/shared'
import * as authService from '../services/authService.js'
import { AUTH_PROVIDERS } from '../services/authProvider.js'
import * as kugouAuth from '../services/kugouAuthService.js'
import * as tencentAuth from '../services/tencentAuthService.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { logger } from '../utils/logger.js'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { checkAuthRateLimit } from '../middleware/socketRateLimiter.js'

/** 获取 socket 对应的房间映射（roomId + persistent userId） */
function getSocketMapping(socketId: string) {
  return roomRepo.getSocketMapping(socketId) ?? null
}

/** 支持 QR 扫码登录的平台集合 */
const QR_PLATFORMS = new Set<MusicSource>(['netease', 'kugou', 'kugou_concept', 'tencent', 'bilibili'])

/** 支持 Cookie 登录的平台集合 */
const VALID_PLATFORMS = new Set<MusicSource>(['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili'])

export function registerAuthController(io: TypedServer, socket: TypedSocket) {
  // 防止同一 QR 会话重复处理 803 成功状态
  let qrSuccessHandled = false
  let activeQr: { key: string; platform: MusicSource } | null = null
  let qrRequestVersion = 0
  let qrCheckInFlight = false

  // -------------------------------------------------------------------------
  // QR 扫码登录（所有平台统一处理）
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_REQUEST_QR, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    qrSuccessHandled = false
    activeQr = null
    const requestVersion = ++qrRequestVersion
    try {
      const platform = data?.platform as MusicSource
      if (!platform || !QR_PLATFORMS.has(platform)) {
        socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '暂不支持该平台扫码登录' })
        return
      }

      const provider = AUTH_PROVIDERS[platform]
      const result = await provider.generateQrCode()

      // A newer QR request superseded this asynchronous response.
      if (requestVersion !== qrRequestVersion) return

      if (!result) {
        socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '生成二维码失败，请重试' })
        return
      }

      activeQr = { key: result.key, platform }
      socket.emit(EVENTS.AUTH_QR_GENERATED, { key: result.key, qrimg: result.qrimg })
    } catch (err) {
      logger.error('AUTH_REQUEST_QR error', err, { socketId: socket.id })
      if (requestVersion !== qrRequestVersion) return
      socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '请求失败，请重试' })
    }
  })

  socket.on(EVENTS.AUTH_CHECK_QR, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    try {
      if (!data?.key) {
        socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '缺少二维码 key' })
        return
      }

      const platform = data.platform as MusicSource
      if (!platform || !QR_PLATFORMS.has(platform)) {
        logger.warn('AUTH_CHECK_QR: invalid or missing platform', { platform })
        return
      }

      if (!activeQr || activeQr.key !== data.key || activeQr.platform !== platform) {
        logger.debug('AUTH_CHECK_QR: ignoring stale QR session', { platform })
        return
      }
      if (qrSuccessHandled) return
      if (qrCheckInFlight) return
      qrCheckInFlight = true

      const provider = AUTH_PROVIDERS[platform]
      const result = await provider.checkQrStatus(data.key)
      if (!activeQr || activeQr.key !== data.key) {
        qrCheckInFlight = false
        return
      }

      if (result.status !== QR_STATUS.SUCCESS) {
        qrCheckInFlight = false
        socket.emit(EVENTS.AUTH_QR_STATUS, { status: result.status, message: result.message, key: data.key })
        return
      }
      if (!result.cookie) {
        qrCheckInFlight = false
        activeQr = null
        socket.emit(EVENTS.AUTH_QR_STATUS, {
          status: QR_STATUS.EXPIRED,
          message: '登录成功但未获取到凭据，请重新获取二维码',
          key: data.key,
        })
        return
      }
      if (platform === 'tencent' && !tencentAuth.isRefreshableCredential(result.cookie)) {
        qrCheckInFlight = false
        activeQr = null
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: false,
          message: '未获取到 QQ 音乐刷新凭证，请重新扫码登录',
          platform,
          reason: 'reauth_required',
        })
        socket.emit(EVENTS.AUTH_QR_STATUS, {
          status: QR_STATUS.EXPIRED,
          message: '未获取到刷新凭证，请重新获取二维码',
          key: data.key,
        })
        return
      }

      // 登录成功：验证 cookie 并加入池（防止重复 803）
      if (result.status === QR_STATUS.SUCCESS && result.cookie && !qrSuccessHandled) {
        qrSuccessHandled = true

        let infoResult = await provider.getUserInfo(result.cookie)
        if (!infoResult.ok && infoResult.reason === 'error') {
          await new Promise((resolve) => setTimeout(resolve, 1_000))
          infoResult = await provider.getUserInfo(result.cookie)
        }

        if (infoResult.ok) {
          const userInfo = infoResult.data
          const mapping = getSocketMapping(socket.id)
          if (mapping) {
            authService.addCookie(
              mapping.roomId,
              platform,
              mapping.userId,
              result.cookie,
              userInfo.nickname,
              userInfo.vipType,
              true,
              { vipLabel: userInfo.vipLabel, vipLevel: userInfo.vipLevel },
            )
            broadcastAuthStatus(io, socket, mapping)
          }
          socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
            success: true,
            message: `已登录为 ${userInfo.nickname}`,
            platform,
            cookie: result.cookie,
          })
          socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.SUCCESS, message: '登录成功', key: data.key })
          logger.info(`${platform} 扫码登录成功：${userInfo.nickname}`, {
            event: 'auth.qr_login_succeeded',
            platform,
            nickname: userInfo.nickname,
            vipType: userInfo.vipType,
          })
        } else {
          socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
            success: false,
            message: '登录成功但无法获取用户信息',
            platform,
            reason: infoResult.reason,
          })
          socket.emit(EVENTS.AUTH_QR_STATUS, {
            status: QR_STATUS.EXPIRED,
            message: '登录凭据验证失败，请重新获取二维码',
            key: data.key,
          })
        }
      }
      activeQr = null
      qrCheckInFlight = false
    } catch (err) {
      logger.error('AUTH_CHECK_QR error', err, { socketId: socket.id })
      qrCheckInFlight = false
      if (data?.key && activeQr?.key !== data.key) return
      socket.emit(EVENTS.AUTH_QR_STATUS, {
        status: QR_STATUS.EXPIRED,
        message: '检查登录状态失败，请重试',
        key: data?.key,
      })
    }
  })

  // -------------------------------------------------------------------------
  // 手动 Cookie 登录（同时用于 localStorage 自动恢复）
  // 策略模式：所有平台统一流程 — getUserInfo → 重试 → 成功/失败处理
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_SET_COOKIE, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    try {
      if (
        !data?.platform ||
        !VALID_PLATFORMS.has(data.platform) ||
        !data?.cookie ||
        typeof data.cookie !== 'string' ||
        data.cookie.length > 8000
      ) {
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: false,
          message: '参数不完整',
        })
        return
      }

      const { cookie } = data
      const platform = data.platform as MusicSource
      const mapping = getSocketMapping(socket.id)
      const roomId = mapping?.roomId ?? null
      const serverCookie = mapping && roomId ? authService.getUserCookie(mapping.userId, platform, roomId) : null
      const incomingTencentCredential = platform === 'tencent' ? tencentAuth.parseTencentCredential(cookie) : null
      const serverTencentCredential =
        platform === 'tencent' && serverCookie ? tencentAuth.parseTencentCredential(serverCookie) : null

      // A scheduled refresh updates the server copy first. On reconnect, send
      // that newer credential back instead of allowing stale localStorage to
      // overwrite it with the pre-refresh musickey.
      if (
        platform === 'tencent' &&
        serverCookie &&
        serverCookie !== cookie &&
        incomingTencentCredential?.musicid === serverTencentCredential?.musicid &&
        tencentAuth.isRefreshableCredential(serverCookie)
      ) {
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: true,
          message: '已恢复服务器上的最新 QQ 音乐凭证',
          platform,
          cookie: serverCookie,
        })
        if (mapping) broadcastAuthStatus(io, socket, mapping)
        return
      }

      if (platform === 'tencent' && !tencentAuth.isRefreshableCredential(cookie)) {
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: false,
          message: 'QQ 音乐登录凭证已升级，请重新扫码登录',
          platform,
          reason: 'reauth_required',
        })
        if (mapping) broadcastAuthStatus(io, socket, mapping)
        return
      }

      // Fast path: cookie 已在房间池中，跳过验证
      if (
        mapping &&
        roomId &&
        authService.getUserCookie(mapping.userId, platform, roomId) === cookie &&
        !authService.needsMembershipRefresh(mapping.userId, platform, roomId)
      ) {
        if (data.persist !== false) {
          authService.persistUserCookieFromRoom(roomId, platform, mapping.userId)
        }
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: true,
          message: 'Cookie 已生效',
          platform,
          cookie,
        })
        broadcastAuthStatus(io, socket, mapping)
        return
      }

      // 通用验证流程：getUserInfo + 1 次重试
      const provider = AUTH_PROVIDERS[platform]
      let infoResult = await provider.getUserInfo(cookie)
      if (!infoResult.ok) {
        logger.debug(`${platform} 用户信息获取失败，正在重试一次`, { platform, reason: infoResult.reason })
        await new Promise((r) => setTimeout(r, 1500))
        infoResult = await provider.getUserInfo(cookie)
      }

      if (infoResult.ok) {
        const userInfo = infoResult.data
        if (mapping && mapping.roomId) {
          authService.addCookie(
            mapping.roomId,
            platform,
            mapping.userId,
            cookie,
            userInfo.nickname,
            userInfo.vipType,
            data.persist !== false,
            { vipLabel: userInfo.vipLabel, vipLevel: userInfo.vipLevel },
          )
        }
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: true,
          message: `已登录为 ${userInfo.nickname}`,
          platform,
          cookie,
        })
      } else if ((platform === 'netease' || platform === 'bilibili') && infoResult.reason === 'expired') {
        // 仅网易云：明确过期时拒绝保存
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: false,
          message: 'Cookie 已过期，请重新登录',
          platform,
          reason: infoResult.reason,
        })
        if (mapping) broadcastAuthStatus(io, socket, mapping)
        return
      } else {
        // 酷狗/QQ 音乐：验证失败也保存（可能是 API 变动，播放时可能仍有效）
        if (mapping && mapping.roomId) {
          authService.addCookie(mapping.roomId, platform, mapping.userId, cookie, '手动登录', 0, data.persist !== false)
        }
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: true,
          message: 'Cookie 已保存（验证失败，播放时生效）',
          platform,
          cookie,
        })
      }

      if (mapping) {
        broadcastAuthStatus(io, socket, mapping)
      }
    } catch (err) {
      logger.error('AUTH_SET_COOKIE error', err, { socketId: socket.id })
      socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
        success: false,
        message: '设置 Cookie 失败，请重试',
        reason: 'error',
      })
    }
  })

  // -------------------------------------------------------------------------
  // 酷狗概念版：手动领取每日官方权益
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP, async () => {
    try {
      const mapping = getSocketMapping(socket.id)
      if (!mapping) {
        socket.emit(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, { success: false, message: '请先进入房间后再领取' })
        return
      }

      const cookie = authService.getUserCookie(mapping.userId, 'kugou_concept', mapping.roomId)
      if (!cookie) {
        socket.emit(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, {
          success: false,
          message: '请先登录酷狗概念版账号',
        })
        return
      }

      let result = await kugouAuth.claimConceptDailyVip(cookie)
      const claimAccepted = result.ok
      let info: Awaited<ReturnType<typeof kugouAuth.conceptAuthProvider.getUserInfo>> | null = null
      if (claimAccepted) {
        // The daily benefit is eventually consistent. Do not report success or
        // overwrite the account with vipType=0 until Kugou confirms it.
        for (const delayMs of [500, 1_000, 2_000]) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          info = await kugouAuth.conceptAuthProvider.getUserInfo(cookie)
          if (info.ok && info.data.vipType > 0) break
        }
      } else {
        // The claim endpoint may reject a duplicate claim even though today's
        // benefit is already active. Query the authoritative membership state.
        info = await kugouAuth.conceptAuthProvider.getUserInfo(cookie)
      }

      if (info?.ok && info.data.vipType > 0) {
        if (!claimAccepted) result = { ok: true, message: '今日概念版畅听 VIP 权益已生效' }
        const currentMapping = getSocketMapping(socket.id)
        const currentCookie = currentMapping
          ? authService.getUserCookie(currentMapping.userId, 'kugou_concept', currentMapping.roomId)
          : null
        const canApplyRefresh =
          currentMapping?.roomId === mapping.roomId &&
          currentMapping.userId === mapping.userId &&
          currentCookie === cookie

        if (canApplyRefresh) {
          authService.addCookie(
            currentMapping.roomId,
            'kugou_concept',
            currentMapping.userId,
            cookie,
            info.data.nickname,
            info.data.vipType,
            true,
            { vipLabel: info.data.vipLabel, vipLevel: info.data.vipLevel },
          )
          broadcastAuthStatus(io, socket, currentMapping)
        } else {
          logger.info('领取酷狗概念版权益后用户状态已变化，已跳过房间账号刷新', {
            event: 'auth.kugou_concept_claim_refresh_skipped',
            roomId: mapping.roomId,
            userId: mapping.userId,
            currentRoomId: currentMapping?.roomId,
          })
        }
      } else if (claimAccepted) {
        result = {
          ok: false,
          message: '领取接口已返回成功，但酷狗尚未确认畅听 VIP 生效，请稍后重新领取或重新登录概念版',
        }
        logger.warn('领取酷狗概念版权益后会员状态未生效', {
          event: 'auth.kugou_concept_claim_not_effective',
          roomId: mapping.roomId,
          userId: mapping.userId,
          refreshed: Boolean(info?.ok),
          vipType: info?.ok ? info.data.vipType : null,
        })
      }

      socket.emit(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, { success: result.ok, message: result.message })
    } catch (err) {
      logger.error('AUTH_CLAIM_KUGOU_CONCEPT_VIP error', err, { socketId: socket.id })
      socket.emit(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, { success: false, message: '领取失败，请稍后重试' })
    }
  })

  // -------------------------------------------------------------------------
  // 登出
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_LOGOUT, (data) => {
    try {
      if (!data?.platform) return
      const mapping = getSocketMapping(socket.id)
      if (mapping) {
        authService.removeCookie(mapping.roomId, data.platform, mapping.userId)
        broadcastAuthStatus(io, socket, mapping)
      }
    } catch (err) {
      logger.error('AUTH_LOGOUT handler error', err, { socketId: socket.id })
    }
  })

  // -------------------------------------------------------------------------
  // 拉取当前认证状态（覆盖延迟挂载场景）
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_GET_STATUS, () => {
    try {
      const mapping = getSocketMapping(socket.id)
      if (mapping) {
        broadcastAuthStatus(io, socket, mapping)
      }
    } catch (err) {
      logger.error('AUTH_GET_STATUS handler error', err, { socketId: socket.id })
    }
  })

  // NOTE: No disconnect handler — cookies stay in the room pool
  // until the room itself is destroyed (see roomService.scheduleDeletion).
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 广播认证状态（房间级作用域，非全局）
 * 向请求用户发送个人状态 + 向房间广播聚合状态
 */
function broadcastAuthStatus(io: TypedServer, socket: TypedSocket, mapping: { roomId: string; userId: string }) {
  socket.emit(EVENTS.AUTH_MY_STATUS, authService.getUserAuthStatus(mapping.userId, mapping.roomId))
  io.to(mapping.roomId).emit(EVENTS.AUTH_STATUS_UPDATE, authService.getAllPlatformStatus(mapping.roomId))
}
