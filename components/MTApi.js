import Config from "./Config.js"
import { Log_Prefix, LIMITS } from "./Constants.js"

const IDENTITY_COOKIE_NAME = "mt_identity"

/**
 * music-together REST API 客户端
 *
 * 服务端身份基于 HttpOnly Cookie `mt_identity`（HMAC-SHA256 签名），
 * 由 POST /api/auth/identity/bootstrap 签发，HTTP 与 WebSocket handshake 共用。
 */
class MTApi {
  constructor() {
    const savedIdentity = Config.auth
    /** @type {string|null} 当前持有的 mt_identity token */
    this.identityToken = savedIdentity.token ? String(savedIdentity.token) : null
    /** @type {string|null} 服务端返回的用户 id */
    this.identityUserId = savedIdentity.userId ? String(savedIdentity.userId) : null
    /** @type {number} Cookie 过期时间戳 */
    this.identityExpiresAt = Number(savedIdentity.expiresAt) || 0
    /** @type {object|null} 当前账号资料 */
    this.identityProfile =
      savedIdentity.profile && typeof savedIdentity.profile === "object"
        ? savedIdentity.profile
        : null
    /** @type {Promise|null} bootstrap 去重 */
    this.bootstrapPromise = null
  }

  /** 服务端基址，去掉尾部斜杠 */
  get baseUrl() {
    return String(Config.server.baseUrl || "http://127.0.0.1:3001").replace(/\/+$/, "")
  }

  /** WebSocket 地址，未显式配置时由 baseUrl 推导 */
  get wsUrl() {
    const custom = Config.server.wsUrl
    if (custom) return String(custom).replace(/\/+$/, "")
    return `${this.baseUrl.replace(/^http/, "ws")}/ws`
  }

  /** 请求超时（毫秒） */
  get timeout() {
    return Number(Config.server.requestTimeout || 20000)
  }

  /** 当前 Cookie 头，用于 HTTP 与 WS handshake */
  get cookieHeader() {
    return this.identityToken ? `${IDENTITY_COOKIE_NAME}=${this.identityToken}` : ""
  }

  /** 身份凭据是否可用 */
  get hasIdentity() {
    return (
      Boolean(this.identityToken) &&
      (!this.identityExpiresAt || Date.now() < this.identityExpiresAt)
    )
  }

  get profileNickname() {
    return this.identityProfile?.nickname ? String(this.identityProfile.nickname) : ""
  }

  #persistIdentity() {
    Config.setAuth({
      token: this.identityToken,
      userId: this.identityUserId,
      expiresAt: this.identityExpiresAt,
      profile: this.identityProfile,
    })
  }

  /** 清除本地身份缓存 */
  clearIdentity() {
    this.identityToken = null
    this.identityUserId = null
    this.identityExpiresAt = 0
    this.identityProfile = null
    Config.clearAuth()
  }

  /**
   * 从 Set-Cookie 响应头中提取 mt_identity
   * @param {Response} res
   */
  #captureCookie(res) {
    const raw =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [res.headers.get("set-cookie")].filter(Boolean)

    for (const line of raw) {
      const match = /(?:^|;\s*)mt_identity=([^;]+)/.exec(line)
      if (!match) continue
      this.identityToken = decodeURIComponent(match[1])
      const maxAge = /Max-Age=(\d+)/i.exec(line)
      if (maxAge) this.identityExpiresAt = Date.now() + Number(maxAge[1]) * 1000
    }

    const userId = res.headers.get("x-identity-userid")
    if (userId) this.identityUserId = userId
    const expiresAt = res.headers.get("x-identity-expires-at")
    if (expiresAt) this.identityExpiresAt = Number(expiresAt)
  }

  /**
   * 签发/续期身份凭据
   * @param {boolean} force 强制重新签发
   */
  async bootstrap(force = false) {
    if (!force && this.hasIdentity) return this.identityUserId
    if (this.bootstrapPromise) return this.bootstrapPromise

    this.bootstrapPromise = (async () => {
      const res = await this.#fetch("POST", "/api/auth/identity/bootstrap", { raw: true })
      this.#captureCookie(res)
      if (!this.identityToken) throw new Error("服务端未返回身份凭据，请确认服务端版本")
      this.#persistIdentity()
      logger.debug(`${Log_Prefix} 已获取身份凭据 userId=${this.identityUserId}`)
      return this.identityUserId
    })().finally(() => {
      this.bootstrapPromise = null
    })

    return this.bootstrapPromise
  }

  /** 使用 Music Together 账号 ID 和密码恢复正式身份。 */
  async recoverIdentity(accountId, password) {
    const result = await this.#fetch("POST", "/api/auth/identity/recover", {
      body: { accountId: String(accountId).trim(), password: String(password) },
    })
    if (!this.identityToken) throw new Error("服务端未返回账号身份凭据")
    this.identityUserId = result?.userId || this.identityUserId
    this.identityExpiresAt = Number(result?.expiresAt) || this.identityExpiresAt
    this.identityProfile = null
    this.#persistIdentity()
    return result
  }

  /** 获取当前 Music Together 账号资料。 */
  async getProfile() {
    const profile = await this.get("/api/auth/me")
    if (profile && typeof profile === "object") {
      this.identityProfile = profile
      this.#persistIdentity()
    }
    return profile
  }

  /**
   * 底层请求
   * @param {string} method
   * @param {string} pathname
   * @param {object} options
   */
  async #fetch(method, pathname, options = {}) {
    const { body, raw = false, query } = options
    let url = `${this.baseUrl}${pathname}`
    if (query) {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue
        search.append(key, String(value))
      }
      const qs = search.toString()
      if (qs) url += `?${qs}`
    }

    const headers = { Accept: "application/json" }
    if (this.cookieHeader) headers.Cookie = this.cookieHeader
    if (body !== undefined) headers["Content-Type"] = "application/json"

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    let res
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if (err.name === "AbortError") throw new Error(`请求超时：${method} ${pathname}`)
      throw new Error(`无法连接服务端 ${this.baseUrl}：${err.message}`)
    } finally {
      clearTimeout(timer)
    }

    if (raw) {
      if (!res.ok) throw new Error(await this.#errorMessage(res))
      return res
    }

    this.#captureCookie(res)

    if (!res.ok) throw new Error(await this.#errorMessage(res))
    if (res.status === 204) return null

    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  /**
   * 解析错误响应
   * @param {Response} res
   */
  async #errorMessage(res) {
    let detail = ""
    try {
      const text = await res.text()
      if (text) {
        try {
          const json = JSON.parse(text)
          detail = json.error || json.message || text
        } catch {
          detail = text
        }
      }
    } catch {
      /* 忽略读取失败 */
    }
    return `服务端返回 ${res.status}${detail ? `：${String(detail).slice(0, 200)}` : ""}`
  }

  /**
   * 带身份的 GET
   * @param {string} pathname
   * @param {object} query
   */
  async get(pathname, query) {
    await this.bootstrap()
    try {
      return await this.#fetch("GET", pathname, { query })
    } catch (err) {
      if (/返回 401/.test(err.message)) {
        this.clearIdentity()
        await this.bootstrap(true)
        return this.#fetch("GET", pathname, { query })
      }
      throw err
    }
  }

  /**
   * 带身份的 POST
   * @param {string} pathname
   * @param {object} body
   */
  async post(pathname, body) {
    await this.bootstrap()
    return this.#fetch("POST", pathname, { body })
  }

  /* ---------------- 房间 ---------------- */

  /**
   * 查询房间是否存在及是否需要密码
   * @param {string} roomId
   */
  checkRoom(roomId) {
    return this.get(`/api/rooms/${encodeURIComponent(roomId)}/check`)
  }

  /**
   * 获取房间分享二维码
   * @param {string} roomId
   */
  roomShareQr(roomId, link) {
    const inviteLink = link || `${this.baseUrl}/join?ROMMid=${encodeURIComponent(roomId)}`
    return this.get(`/api/rooms/${encodeURIComponent(roomId)}/share/qr`, { link: inviteLink })
  }

  /* ---------------- 音乐 ---------------- */

  /**
   * 搜索
   * @param {object} params
   * @param {string} params.keyword 关键词
   * @param {string} params.source 音源
   * @param {number} [params.limit] 数量，上限 50
   * @param {number} [params.page] 页码，上限 100
   * @param {'song'|'album'|'playlist'} [params.type] 类型
   * @param {string} [params.roomId] 房间号，用于复用房间登录态
   */
  search({ keyword, source = "netease", limit = 10, page = 1, type = "song", roomId }) {
    const max =
      source === "bilibili"
        ? LIMITS.BILIBILI_SEARCH_INPUT_MAX_LENGTH
        : LIMITS.SEARCH_KEYWORD_MAX_LENGTH
    return this.get("/api/music/search", {
      keyword: String(keyword).slice(0, max),
      source,
      limit: Math.min(Math.max(Number(limit) || 10, 1), LIMITS.SEARCH_PAGE_SIZE_MAX),
      page: Math.min(Math.max(Number(page) || 1, 1), LIMITS.SEARCH_PAGE_MAX),
      type,
      roomId: roomId ? String(roomId).slice(0, LIMITS.ROOM_ID_MAX_LENGTH) : undefined,
    })
  }

  /**
   * 热歌榜
   * @param {object} params
   */
  hotSongs({ roomId, source = "netease", limit = 20, offset = 0, refresh = false }) {
    return this.get("/api/music/hot", {
      roomId: String(roomId).slice(0, LIMITS.ROOM_ID_MAX_LENGTH),
      source,
      limit: Math.min(Math.max(Number(limit) || 20, 1), 30),
      offset: Math.min(Math.max(Number(offset) || 0, 0), 500),
      refresh: refresh ? "true" : "false",
    })
  }

  /**
   * 平台推荐
   * @param {object} params
   */
  recommendations({ roomId, platform, limit = 20 }) {
    return this.get("/api/music/recommendations", {
      roomId: String(roomId).slice(0, LIMITS.ROOM_ID_MAX_LENGTH),
      platform,
      limit: Math.min(Math.max(Number(limit) || 20, 1), LIMITS.SEARCH_PAGE_SIZE_MAX),
    })
  }

  /**
   * 获取歌单/专辑内容
   * @param {object} params
   */
  playlist({
    source,
    id,
    limit = LIMITS.PLAYLIST_PAGE_SIZE,
    offset = 0,
    roomId,
    type = "playlist",
  }) {
    return this.get("/api/music/playlist", {
      source,
      id: String(id).slice(0, LIMITS.PLAYLIST_ID_MAX_LENGTH),
      limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
      offset: Math.max(Number(offset) || 0, 0),
      roomId: roomId ? String(roomId).slice(0, LIMITS.ROOM_ID_MAX_LENGTH) : undefined,
      type,
    })
  }

  /**
   * 获取歌词
   * @param {object} params
   */
  lyric({ source, lyricId }) {
    return this.get("/api/music/lyric", { source, lyricId })
  }

  /**
   * 获取封面直链
   * @param {object} params
   */
  cover({ source, picId, size }) {
    return this.get("/api/music/cover", { source, picId, size })
  }

  /**
   * 获取播放直链
   * @param {object} params
   */
  url({ source, urlId, bitrate = 320 }) {
    return this.get("/api/music/url", { source, urlId, bitrate })
  }

  /**
   * 获取可下载音质列表
   * @param {object} params
   */
  downloadOptions({ roomId, trackId }) {
    return this.get("/api/music/download-options", { roomId, trackId })
  }

  /**
   * 下载当前歌曲音频。该接口需要当前身份仍在对应房间内。
   * @param {object} params
   * @param {string} params.roomId
   * @param {string} params.trackId
   * @param {number|string} params.quality
   * @returns {Promise<Response>}
   */
  async download({ roomId, trackId, quality = 128 }) {
    await this.bootstrap()
    return this.#fetch("GET", "/api/music/download", {
      raw: true,
      query: { roomId, trackId, quality },
    })
  }

  /**
   * B 站合集解析
   * @param {string} bvid
   */
  bilibiliCollection(bvid) {
    return this.get("/api/music/bilibili-collection", { bvid })
  }
}

export default new MTApi()
