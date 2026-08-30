import { EventEmitter } from "node:events"
import { WebSocket } from "ws"
import Config from "./Config.js"
import MTApi from "./MTApi.js"
import { EVENTS, TIMING, Log_Prefix } from "./Constants.js"

const sessions = new Map()

function timeoutError(event) {
  return new Error(`等待服务端事件超时：${event}`)
}

/**
 * 一个群对应一个 Music Together socket 会话。
 * 会话只负责协议和状态，不直接发送 QQ 消息，便于命令与事件通知复用。
 */
class MTSocket extends EventEmitter {
  constructor(groupId) {
    super()
    this.groupId = String(groupId)
    this.ws = null
    this.roomId = null
    this.roomState = null
    this.rejoinToken = null
    this.roomPassword = null
    this.roomNickname = null
    this.connectPromise = null
    this.closedByUser = false
    this.retryCount = 0
    this.retryTimer = null
    this.pending = new Map()
    this.lastTrackId = null
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  async connect() {
    if (this.connected) return this
    if (this.connectPromise) return this.connectPromise

    this.closedByUser = false
    this.connectPromise = (async () => {
      await MTApi.bootstrap()
      const ws = new WebSocket(MTApi.wsUrl, {
        headers: MTApi.cookieHeader ? { Cookie: MTApi.cookieHeader } : undefined,
      })
      this.ws = ws

      await new Promise((resolve, reject) => {
        let settled = false
        const finish = error => {
          if (settled) return
          settled = true
          error ? reject(error) : resolve()
        }
        ws.once("open", () => finish())
        ws.once("error", error => finish(error))
      })

      this.retryCount = 0
      ws.on("message", raw => this.#onMessage(raw))
      ws.on("close", () => this.#onClose())
      ws.on("error", error => this.emit("error", error))
      logger.debug(`${Log_Prefix} 群 ${this.groupId} WebSocket 已连接`)
      this.emit("connect")
      return this
    })()
      .catch(error => {
        if (this.ws?.readyState !== WebSocket.OPEN) this.ws = null
        throw error
      })
      .finally(() => {
        this.connectPromise = null
      })

    return this.connectPromise
  }

  /** 身份 Cookie 更新后，重建握手并重新加入原房间。 */
  async reconnect() {
    const roomId = this.roomId
    const nickname = this.roomNickname || Config.room.nickname
    const password = this.roomPassword || undefined
    const rejoinToken = this.rejoinToken
    const oldSocket = this.ws
    this.closedByUser = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null

    if (oldSocket && oldSocket.readyState !== WebSocket.CLOSED) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 1000)
        oldSocket.once("close", () => {
          clearTimeout(timer)
          resolve()
        })
        try {
          oldSocket.close()
        } catch {
          resolve()
        }
      })
    }
    this.ws = null
    this.closedByUser = false
    await this.connect()
    if (roomId) await this.join(roomId, nickname, password, rejoinToken)
    return this
  }

  #onMessage(raw) {
    let packet
    try {
      packet = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!packet || typeof packet.event !== "string") return
    const { event, data } = packet
    this.#settlePending(event, data)

    if (event === EVENTS.ROOM_STATE) {
      this.roomState = data
      this.roomId = data?.id || this.roomId
      const trackId = data?.currentTrack?.id ?? null
      const changed = trackId !== this.lastTrackId
      this.lastTrackId = trackId
      if (changed) this.emit("trackChange", data?.currentTrack ?? null, data)
    } else if (event === EVENTS.PLAYER_PLAY && this.roomState) {
      this.roomState = {
        ...this.roomState,
        currentTrack: data?.track || this.roomState.currentTrack,
        playState: data?.playState || this.roomState.playState,
      }
      const track = data?.track || null
      if (track?.id !== this.lastTrackId) {
        this.lastTrackId = track?.id ?? null
        this.emit("trackChange", track, this.roomState)
      }
    } else if (
      (event === EVENTS.PLAYER_PAUSE ||
        event === EVENTS.PLAYER_RESUME ||
        event === EVENTS.PLAYER_SEEK) &&
      this.roomState
    ) {
      this.roomState = { ...this.roomState, playState: data?.playState || this.roomState.playState }
    } else if (event === EVENTS.ROOM_REJOIN_TOKEN) {
      this.roomId = data?.roomId || this.roomId
      this.rejoinToken = data?.token || null
    } else if (event === EVENTS.QUEUE_UPDATED && this.roomState) {
      this.roomState = { ...this.roomState, queue: data?.queue || [] }
    }
    this.emit(event, data)
  }

  #settlePending(event, data) {
    const entries = this.pending.get(event)
    if (!entries) return
    this.pending.delete(event)
    for (const item of entries) {
      clearTimeout(item.timer)
      item.resolve(data)
    }
  }

  #onClose() {
    const wasUserClosed = this.closedByUser
    this.ws = null
    for (const [event, entries] of this.pending) {
      this.pending.delete(event)
      for (const item of entries) {
        clearTimeout(item.timer)
        item.reject(new Error("Music Together WebSocket 已断开"))
      }
    }
    this.emit("disconnect")
    if (!wasUserClosed && Config.room.autoRejoin) this.#scheduleReconnect()
  }

  #scheduleReconnect() {
    if (this.retryTimer || this.closedByUser) return
    const maxRetries = Math.max(0, Number(Config.room.reconnectMaxRetries ?? 10))
    if (this.retryCount >= maxRetries) return
    const base = Math.max(250, Number(Config.room.reconnectBaseDelay ?? 2000))
    const delay = Math.min(base * 2 ** this.retryCount, 60_000)
    this.retryCount += 1
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null
      try {
        await this.connect()
        if (this.roomId) {
          await this.join(
            this.roomId,
            this.roomNickname || Config.room.nickname,
            this.roomPassword || undefined,
            this.rejoinToken,
          )
        }
      } catch (error) {
        logger.debug(`${Log_Prefix} 群 ${this.groupId} 重连失败：${error.message}`)
        this.#scheduleReconnect()
      }
    }, delay)
    this.retryTimer.unref?.()
  }

  waitFor(event, timeout = Config.server.timeout) {
    let cancel = () => {}
    const promise = new Promise((resolve, reject) => {
      const item = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const entries = this.pending.get(event) || []
          this.pending.set(
            event,
            entries.filter(value => value !== item),
          )
          reject(timeoutError(event))
        }, timeout),
      }
      const entries = this.pending.get(event) || []
      entries.push(item)
      this.pending.set(event, entries)
      cancel = () => {
        clearTimeout(item.timer)
        const current = this.pending.get(event) || []
        const remaining = current.filter(value => value !== item)
        if (remaining.length) this.pending.set(event, remaining)
        else this.pending.delete(event)
      }
    })
    promise.cancel = cancel
    return promise
  }

  send(event, data) {
    if (!this.connected) throw new Error("Music Together WebSocket 未连接")
    this.ws.send(JSON.stringify({ event, data }))
  }

  async request(event, data, responseEvent = event, timeout = Config.server.timeout) {
    await this.connect()
    const response = this.waitFor(responseEvent, timeout)
    this.send(event, data)
    return response
  }

  async create({ nickname, roomName, password }) {
    await this.connect()
    const statePromise = this.waitFor(EVENTS.ROOM_STATE)
    const createdPromise = this.request(
      EVENTS.ROOM_CREATE,
      { nickname, roomName, password },
      EVENTS.ROOM_CREATED,
    )
    const created = await createdPromise
    this.roomId = created?.roomId || this.roomId
    this.roomNickname = nickname
    this.roomPassword = password || null
    await statePromise.catch(() => null)
    statePromise.cancel?.()
    return created
  }

  async join(roomId, nickname, password, rejoinToken) {
    await this.connect()
    const statePromise = this.waitFor(EVENTS.ROOM_STATE)
    const errorWaiter = this.waitFor(EVENTS.ROOM_ERROR)
    const errorPromise = errorWaiter.then(error => {
      throw new Error(error?.message || "加入房间失败")
    })
    this.send(EVENTS.ROOM_JOIN, {
      roomId: String(roomId),
      nickname,
      ...(password ? { password } : {}),
      ...(rejoinToken ? { rejoinToken } : {}),
    })
    let state
    try {
      state = await Promise.race([statePromise, errorPromise])
    } finally {
      statePromise.cancel?.()
      errorWaiter.cancel?.()
    }
    this.roomId = state?.id || String(roomId)
    this.roomState = state
    this.roomNickname = nickname
    this.roomPassword = password || null
    return state
  }

  leave() {
    if (this.connected) this.send(EVENTS.ROOM_LEAVE)
    this.roomId = null
    this.roomState = null
    this.rejoinToken = null
    this.roomPassword = null
    this.roomNickname = null
    this.lastTrackId = null
  }

  close() {
    this.closedByUser = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    try {
      this.leave()
    } catch {}
    this.ws?.close()
    this.ws = null
  }
}

export function getSession(groupId) {
  const key = String(groupId)
  let session = sessions.get(key)
  if (!session) {
    session = new MTSocket(key)
    sessions.set(key, session)
  }
  return session
}

export function closeSession(groupId) {
  const key = String(groupId)
  sessions.get(key)?.close()
  sessions.delete(key)
}

export function closeAllSessions() {
  for (const session of sessions.values()) session.close()
  sessions.clear()
}

export { MTSocket }
export default MTSocket
