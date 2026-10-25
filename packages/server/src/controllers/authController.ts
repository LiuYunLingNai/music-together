import { EVENTS, QR_STATUS } from '@music-together/shared'
import type { MusicSource, SavedAccountSummary } from '@music-together/shared'
import * as authService from '../services/authService.js'
import { AUTH_PROVIDERS } from '../services/authProvider.js'
import * as kugouAuth from '../services/kugouAuthService.js'
import * as tencentAuth from '../services/tencentAuthService.js'
import * as localQqLogin from '../services/localQqLoginService.js'
import { platformAuthRepo } from '../repositories/platformAuthRepository.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { logger } from '../utils/logger.js'
import { normalizeCookieInput } from '../utils/cookieUtils.js'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { checkAuthRateLimit } from '../middleware/socketRateLimiter.js'
import * as roomService from '../services/roomService.js'

/** 获取 socket 对应的房间映射（roomId + persistent userId） */
function getSocketMapping(socketId: string) {
  return roomRepo.getSocketMapping(socketId) ?? null
}

/** 支持 QR 扫码登录的平台集合 */
const QR_PLATFORMS = new Set<MusicSource>(['netease', 'kugou', 'kugou_concept', 'tencent', 'bilibili'])

/** 支持 Cookie 登录的平台集合 */
const VALID_PLATFORMS = new Set<MusicSource>(['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili'])

/**
 * 判断某个对端地址是否与**服务端所在机器**相同。
 *
 * 「本机 QQ 一键登录」读取的是服务端所在机器上运行的 QQ 客户端，
 * 只有访问者也在同一台机器上时，探测结果才等于「访问者自己的在线 QQ」。
 * 远端访问拿到的是服务端的账号列表，对访问者毫无意义，还会泄露服务端机器的账号信息，
 * 因此这个判定是安全边界而非体验优化。
 *
 * 判定覆盖 IPv4 回环（127.0.0.0/8）、IPv6 回环（::1）、
 * IPv4-mapped 回环（::ffff:127.0.0.1）以及主机名 `localhost`。
 */
export function isSameMachineAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.trim().toLowerCase()
  if (!normalized) return false
  if (normalized === 'localhost') return true
  // IPv4-mapped IPv6（::ffff:127.0.0.1）先还原成 IPv4 再判断
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized
  if (ipv4 === '::1') return true
  const match = ipv4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const [a, b] = [Number(match[1]), Number(match[2])]
  if (a !== 127) return false
  if (b < 0 || b > 255) return false
  return true
}

/** 读取该用户在该平台已保存账号的展示摘要（不含任何凭据） */
function getSavedAccountSummary(userId: string, platform: MusicSource): SavedAccountSummary | null {
  const entry = platformAuthRepo.loadUser(userId).find((item) => item.platform === platform)
  if (!entry) return null
  return {
    platform,
    nickname: entry.nickname,
    avatarUrl: entry.avatarUrl,
    vipType: entry.vipType,
    vipLabel: entry.vipLabel,
    vipLevel: entry.vipLevel,
  }
}

export function registerAuthController(io: TypedServer, socket: TypedSocket) {
  // 防止同一 QR 会话重复处理 803 成功状态
  let qrSuccessHandled = false
  let activeQr: { key: string; platform: MusicSource; authorization: ReturnType<typeof captureAuthorization> } | null = null
  let qrRequestVersion = 0
  let qrCheckInFlight = false

  const captureAuthorization = (platform: MusicSource) => {
    const mapping = getSocketMapping(socket.id)
    const userId = mapping?.userId ?? socket.data.identityUserId
    const version = authService.getAuthorizationVersion(userId, platform, mapping?.roomId)
    return {
      mapping,
      current: () => socket.connected && getSocketMapping(socket.id) === mapping &&
        authService.getAuthorizationVersion(userId, platform, mapping?.roomId) === version,
    }
  }

  // -------------------------------------------------------------------------
  // QR 扫码登录（所有平台统一处理）
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_REQUEST_QR, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    qrSuccessHandled = false
    activeQr = null
    qrCheckInFlight = false
    const requestVersion = ++qrRequestVersion
    try {
      const platform = data?.platform as MusicSource
      if (!platform || !QR_PLATFORMS.has(platform)) {
        socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '暂不支持该平台扫码登录' })
        return
      }

      const provider = AUTH_PROVIDERS[platform]
      const authorization = captureAuthorization(platform)
      const result = await provider.generateQrCode()

      // A newer QR request superseded this asynchronous response.
      if (requestVersion !== qrRequestVersion || !authorization.current()) return

      if (!result) {
        socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '生成二维码失败，请重试' })
        return
      }

      activeQr = { key: result.key, platform, authorization }
      // 附带已保存账号的展示信息，让弹窗能直接提供「继续使用该账号」的入口。
      // 只下发昵称/头像/会员等展示字段，凭据绝不出现在事件载荷里。
      const mapping = authorization.mapping
      const savedAccount = mapping ? getSavedAccountSummary(mapping.userId, platform) : null
      socket.emit(EVENTS.AUTH_QR_GENERATED, { key: result.key, qrimg: result.qrimg, savedAccount: savedAccount ?? undefined })
    } catch (err) {
      logger.error('AUTH_REQUEST_QR error', err, { socketId: socket.id })
      if (requestVersion !== qrRequestVersion) return
      socket.emit(EVENTS.AUTH_QR_STATUS, { status: QR_STATUS.EXPIRED, message: '请求失败，请重试' })
    }
  })

  socket.on(EVENTS.AUTH_CHECK_QR, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    const requestVersion = qrRequestVersion
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
      const session = activeQr
      if (!session.authorization.current()) {
        activeQr = null
        return
      }
      qrCheckInFlight = true

      const provider = AUTH_PROVIDERS[platform]
      const result = await provider.checkQrStatus(data.key)
      if (activeQr !== session || requestVersion !== qrRequestVersion) return
      if (!session.authorization.current()) {
        activeQr = null
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

        if (activeQr !== session || requestVersion !== qrRequestVersion) return
        if (!session.authorization.current()) {
          activeQr = null
          qrCheckInFlight = false
          return
        }

        if (infoResult.ok) {
          const userInfo = infoResult.data
          const mapping = session.authorization.mapping
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
              userInfo.avatarUrl,
            )
            broadcastAuthStatus(io, socket, mapping)
          }
          socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
            success: true,
            message: `已登录为 ${userInfo.nickname}`,
            platform,
            cookie: result.cookie,
            nickname: userInfo.nickname,
            avatarUrl: userInfo.avatarUrl,
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
      if (requestVersion !== qrRequestVersion) return
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
  // 快捷登录：直接使用服务端已保存的账号，无需重新扫码
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_QUICK_LOGIN, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    try {
      const platform = data?.platform as MusicSource
      if (!platform || !VALID_PLATFORMS.has(platform)) {
        socket.emit(EVENTS.AUTH_QUICK_LOGIN_RESULT, {
          success: false,
          message: '参数不完整',
          reason: 'error',
        })
        return
      }

      const mapping = getSocketMapping(socket.id)
      if (!mapping) {
        socket.emit(EVENTS.AUTH_QUICK_LOGIN_RESULT, {
          success: false,
          message: '请先进入房间',
          reason: 'error',
        })
        return
      }

      const saved = platformAuthRepo.loadUser(mapping.userId).find((entry) => entry.platform === platform)
      if (!saved) {
        socket.emit(EVENTS.AUTH_QUICK_LOGIN_RESULT, {
          success: false,
          message: '没有已保存的账号，请先扫码登录',
          platform,
          reason: 'not_found',
        })
        return
      }

      const authorization = captureAuthorization(platform)
      const provider = AUTH_PROVIDERS[platform]

      // 校验保存的凭据是否仍然有效
      let infoResult = await provider.getUserInfo(saved.cookie)
      if (!infoResult.ok && infoResult.reason === 'error') {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        infoResult = await provider.getUserInfo(saved.cookie)
      }

      if (!authorization.current()) return

      if (!infoResult.ok) {
        // 记录保留，用户可以扫码覆盖，而不是静默丢失账号
        socket.emit(EVENTS.AUTH_QUICK_LOGIN_RESULT, {
          success: false,
          message: infoResult.reason === 'expired' ? '登录状态已过期，请重新扫码登录' : '登录状态校验失败，请重新扫码登录',
          platform,
          nickname: saved.nickname,
          avatarUrl: saved.avatarUrl,
          reason: 'reauth_required',
        })
        return
      }

      const userInfo = infoResult.data
      authService.addCookie(
        mapping.roomId,
        platform,
        mapping.userId,
        saved.cookie,
        userInfo.nickname || saved.nickname,
        userInfo.vipType,
        true,
        { vipLabel: userInfo.vipLabel, vipLevel: userInfo.vipLevel },
        userInfo.avatarUrl ?? saved.avatarUrl,
      )
      broadcastAuthStatus(io, socket, mapping)

      socket.emit(EVENTS.AUTH_QUICK_LOGIN_RESULT, {
        success: true,
        message: `已登录为 ${userInfo.nickname || saved.nickname}`,
        platform,
        nickname: userInfo.nickname || saved.nickname,
        avatarUrl: userInfo.avatarUrl ?? saved.avatarUrl,
      })
      logger.info(`${platform} 快捷登录成功：${userInfo.nickname || saved.nickname}`, {
        event: 'auth.quick_login_succeeded',
        platform,
      })
    } catch (err) {
      logger.error('AUTH_QUICK_LOGIN error', err, { socketId: socket.id })
      socket.emit(EVENTS.AUTH_QUICK_LOGIN_RESULT, {
        success: false,
        message: '快捷登录失败，请重试',
        reason: 'error',
      })
    }
  })

  // -------------------------------------------------------------------------
  // 本机 QQ 一键登录：使用服务端所在机器上已登录的 QQ 客户端
  // 仅同机访问时可用 —— 详见 isSameMachineAddress 的说明
  // -------------------------------------------------------------------------

  socket.on(EVENTS.AUTH_LOCAL_QQ_PROBE, async () => {
    if (!(await checkAuthRateLimit(socket))) return
    try {
      if (!isSameMachineAddress(socket.handshake?.remoteAddress)) {
        socket.emit(EVENTS.AUTH_LOCAL_QQ_ACCOUNTS, {
          available: false,
          accounts: [],
          message: '本机一键登录仅在服务端所在电脑上可用',
        })
        return
      }

      const probe = await localQqLogin.listLocalAccounts()
      socket.emit(EVENTS.AUTH_LOCAL_QQ_ACCOUNTS, {
        available: probe.available,
        accounts: probe.accounts.map((account) => ({
          uin: account.uin,
          nickname: account.nickname,
          avatarUrl: account.avatarUrl,
        })),
        message: probe.message,
      })
    } catch (err) {
      logger.error('AUTH_LOCAL_QQ_PROBE error', err, { socketId: socket.id })
      socket.emit(EVENTS.AUTH_LOCAL_QQ_ACCOUNTS, {
        available: false,
        accounts: [],
        message: '本机 QQ 探测失败',
      })
    }
  })

  socket.on(EVENTS.AUTH_LOCAL_QQ_LOGIN, async (data) => {
    if (!(await checkAuthRateLimit(socket))) return
    try {
      if (!isSameMachineAddress(socket.handshake?.remoteAddress)) {
        socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
          success: false,
          message: '本机一键登录仅在服务端所在电脑上可用',
          reason: 'error',
        })
        return
      }

      const uin = typeof data?.uin === 'string' ? data.uin.trim() : ''
      if (!/^\d{5,12}$/.test(uin)) {
        socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
          success: false,
          message: '账号标识无效',
          reason: 'error',
        })
        return
      }

      const mapping = getSocketMapping(socket.id)
      if (!mapping) {
        socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
          success: false,
          message: '请先进入房间',
          reason: 'error',
        })
        return
      }

      const authorization = captureAuthorization('tencent')
      const credential = await localQqLogin.loginWithLocalAccount(uin)
      if (!credential) {
        socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
          success: false,
          message: '本机 QQ 登录失败，请确认客户端已登录或改用扫码',
          reason: 'reauth_required',
        })
        return
      }

      if (!authorization.current()) return

      const provider = AUTH_PROVIDERS.tencent
      let infoResult = await provider.getUserInfo(credential)
      if (!infoResult.ok && infoResult.reason === 'error') {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        infoResult = await provider.getUserInfo(credential)
      }

      if (!infoResult.ok) {
        socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
          success: false,
          message: '本机 QQ 登录成功但无法获取用户信息',
          reason: 'reauth_required',
        })
        return
      }

      const userInfo = infoResult.data
      authService.addCookie(
        mapping.roomId,
        'tencent',
        mapping.userId,
        credential,
        userInfo.nickname,
        userInfo.vipType,
        true,
        { vipLabel: userInfo.vipLabel, vipLevel: userInfo.vipLevel },
        userInfo.avatarUrl,
      )
      broadcastAuthStatus(io, socket, mapping)

      socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
        success: true,
        message: `已登录为 ${userInfo.nickname}`,
        nickname: userInfo.nickname,
        avatarUrl: userInfo.avatarUrl,
      })
      logger.info(`本机 QQ 一键登录成功：${userInfo.nickname}`, {
        event: 'auth.local_qq_succeeded',
        uin,
      })
    } catch (err) {
      logger.error('AUTH_LOCAL_QQ_LOGIN error', err, { socketId: socket.id })
      socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, {
        success: false,
        message: '本机 QQ 登录失败，请重试',
        reason: 'error',
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

      // 用户常常直接粘贴 DevTools 的「Copy as cURL」结果或带 `Cookie:` 前缀，
      // 这里统一归一化成纯 Cookie 串再往下走。
      const cookie = normalizeCookieInput(data.cookie)
      if (!cookie) {
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: false,
          message: 'Cookie 为空',
        })
        return
      }

      const platform = data.platform as MusicSource
      const authorization = captureAuthorization(platform)
      const mapping = authorization.mapping
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
        // 手机浏览器登录只能拿到 qm_keyst：这类会话凭证可以播放，但无法自动续期。
        // 归一化后接受它，并明确告知用户需要重新扫码才能恢复自动续期。
        const sessionCookie = tencentAuth.buildSessionCredentialCookie(cookie)
        if (!sessionCookie || !tencentAuth.isSessionCredential(sessionCookie)) {
          socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
            success: false,
            message: 'QQ 音乐登录凭证已升级，请重新扫码登录',
            platform,
            reason: 'reauth_required',
          })
          if (mapping) broadcastAuthStatus(io, socket, mapping)
          return
        }

        const sessionAuthorization = captureAuthorization(platform)
        const sessionInfo = await AUTH_PROVIDERS.tencent.getUserInfo(sessionCookie)
        if (!sessionAuthorization.current()) return

        if (!sessionInfo.ok) {
          socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
            success: false,
            message: '登录凭证验证失败，请重新扫码登录',
            platform,
            reason: sessionInfo.reason === 'expired' ? 'expired' : 'error',
          })
          if (mapping) broadcastAuthStatus(io, socket, mapping)
          return
        }

        if (mapping && mapping.roomId) {
          authService.addCookie(
            mapping.roomId,
            platform,
            mapping.userId,
            sessionCookie,
            sessionInfo.data.nickname,
            sessionInfo.data.vipType,
            data.persist !== false,
            { vipLabel: sessionInfo.data.vipLabel, vipLevel: sessionInfo.data.vipLevel },
            sessionInfo.data.avatarUrl,
          )
        }
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: true,
          message: `已登录为 ${sessionInfo.data.nickname}（该凭证无法自动续期，失效后需重新扫码）`,
          platform,
          cookie: sessionCookie,
          nickname: sessionInfo.data.nickname,
          avatarUrl: sessionInfo.data.avatarUrl,
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

      if (!authorization.current()) return

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
            userInfo.avatarUrl,
          )
        }
        socket.emit(EVENTS.AUTH_SET_COOKIE_RESULT, {
          success: true,
          message: `已登录为 ${userInfo.nickname}`,
          platform,
          cookie,
          nickname: userInfo.nickname,
          avatarUrl: userInfo.avatarUrl,
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
      const authorization = captureAuthorization('kugou_concept')
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
          authorization.current() &&
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
      if (!data?.platform || !VALID_PLATFORMS.has(data.platform)) return
      if (activeQr?.platform === data.platform) {
        activeQr = null
        qrRequestVersion++
        qrCheckInFlight = false
      }
      const mapping = getSocketMapping(socket.id)
      if (mapping) {
        authService.removeCookie(mapping.roomId, data.platform, mapping.userId)
        const room = roomRepo.get(mapping.roomId)
        if (
          room?.roamingEnabled &&
          room.creatorId === mapping.userId &&
          room.roamingSource === data.platform &&
          !authService.getUserCookie(room.creatorId, room.roamingSource, room.id)
        ) {
          room.roamingEnabled = false
          roomRepo.persist(room.id)
          io.to(room.id).emit(EVENTS.ROOM_STATE, {
            ...roomService.toPublicRoomState(room),
          })
        }
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
