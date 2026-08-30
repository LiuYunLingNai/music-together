import plugin from "../../../lib/plugins/plugin.js"
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, unlink } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { getMTApi } from "../components/MTApi.js"
import Config from "../components/Config.js"
import { closeSession, getSession, reconnectSessionsForIdentity } from "../components/MTSocket.js"
import {
  EVENTS,
  MUSIC_SOURCES,
  PLAY_MODE_ALIAS,
  PLAY_MODE_NAMES,
  SOURCE_ALIAS,
  SOURCE_NAMES,
  Log_Prefix,
} from "../components/Constants.js"

const searchCache = new Map()
const notificationWired = Symbol.for("music-together-plugin.notification-wired")
const audioTempDir = path.join(process.cwd(), "temp", "music-together-plugin")

function replyFailed(result) {
  return result === false || Boolean(result?.error?.length)
}

function replyError(result) {
  const error = result?.error?.[0]
  return error?.message || String(error || "协议端拒绝发送音频")
}

function audioExtension(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("flac")) return ".flac"
  if (contentType.includes("mp4") || contentType.includes("m4a")) return ".m4a"
  if (contentType.includes("ogg")) return ".ogg"
  if (contentType.includes("wav")) return ".wav"
  return ".mp3"
}

function groupKey(e) {
  return e.group_id ? String(e.group_id) : `private:${e.user_id}`
}

function identityKey(e) {
  return Config.normalizeIdentityKey(e.user_id || "legacy")
}

function nickname(e, api = getMTApi(identityKey(e))) {
  return String(
    api.profileNickname || Config.room.nickname || e.sender?.card || e.sender?.nickname || "Yunzai",
  ).slice(0, 20)
}

function bindingWithRoom(e, roomId, password = "") {
  return {
    ...(Config.getBinding(groupKey(e)) || {}),
    roomId: String(roomId),
    password,
    accountUserId: identityKey(e),
  }
}

function pushEnabled(groupId) {
  return Config.getBinding(String(groupId))?.push?.enabled === true
}

function savePushEnabled(groupId, enabled) {
  const binding = Config.getBinding(String(groupId))
  if (!binding?.roomId) return false
  return Config.setBinding(String(groupId), {
    ...binding,
    push: {
      ...(binding.push || {}),
      enabled: Boolean(enabled),
    },
  })
}

function sourceOf(value) {
  if (!value) return Config.music.defaultSource || "netease"
  return SOURCE_ALIAS[value] || (MUSIC_SOURCES.includes(value) ? value : null)
}

function normalizeTrack(raw, source) {
  const track = raw || {}
  const id = String(track.id ?? track.sourceId ?? track.urlId ?? "")
  return {
    ...track,
    id,
    title: String(track.title || "未知歌曲"),
    artist: Array.isArray(track.artist)
      ? track.artist.map(String)
      : [String(track.artist || "未知歌手")],
    album: String(track.album || "未知专辑"),
    duration: Number(track.duration) || 0,
    cover: String(track.cover || track.thumbnailCover || ""),
    source: track.source || source,
    sourceId: String(track.sourceId ?? id),
    urlId: String(track.urlId ?? track.sourceId ?? id),
  }
}

function formatTrack(track, index) {
  const artists = Array.isArray(track.artist) ? track.artist.join("、") : track.artist
  const duration = track.duration
    ? ` ${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}`
    : ""
  return `${index}. ${track.title} - ${artists}${duration} [${SOURCE_NAMES[track.source] || track.source}]`
}

function sendToGroup(groupId, message) {
  const group = Bot.pickGroup?.(Number(groupId)) || Bot.pickGroup?.(String(groupId))
  return group?.sendMsg?.(message)
}

async function pushToGroup(groupId, message) {
  try {
    await sendToGroup(groupId, message)
  } catch (error) {
    logger.warn(`${Log_Prefix} 群 ${groupId} 推送失败：${error.message}`)
  }
}

function trackPushMessage(track) {
  const artists = Array.isArray(track.artist)
    ? track.artist.join("、")
    : String(track.artist || "未知歌手")
  const text = [
    `▶️ 开始播放：${track.title}`,
    `歌手：${artists}`,
    `专辑：${track.album || "未知专辑"}`,
    `音源：${SOURCE_NAMES[track.source] || track.source || "未知"}`,
  ].join("\n")
  const cover = track.cover || track.thumbnailCover
  return cover ? [text, segment.image(cover)] : text
}

function wireNotifications(session) {
  if (session[notificationWired]) return
  session[notificationWired] = true

  session.on(EVENTS.CHAT_MESSAGE, message => {
    if (!pushEnabled(session.groupId) || !message || message.type === "system") return
    const content = String(message.content || "").trim()
    if (!content) return
    void pushToGroup(session.groupId, `💬 ${message.nickname || "成员"}：${content}`)
  })
  session.on(EVENTS.ROOM_USER_JOINED, user => {
    if (pushEnabled(session.groupId) && Config.chat.notifyUserChange && user?.nickname)
      void pushToGroup(session.groupId, `🎧 ${user.nickname} 加入了听歌房间`)
  })
  session.on(EVENTS.ROOM_USER_LEFT, user => {
    if (pushEnabled(session.groupId) && Config.chat.notifyUserChange && user?.nickname)
      void pushToGroup(session.groupId, `👋 ${user.nickname} 离开了听歌房间`)
  })
  session.on(EVENTS.ROOM_ERROR, error => {
    if (pushEnabled(session.groupId) && error?.message)
      void pushToGroup(session.groupId, `❎ ${error.message}`)
  })
  session.on("trackChange", track => {
    if (!pushEnabled(session.groupId) || !track) return
    void pushToGroup(session.groupId, trackPushMessage(track))
  })
  session.on("error", error =>
    logger.debug(`${Log_Prefix} 群 ${session.groupId} WebSocket：${error.message}`),
  )
}

async function restorePushSessions() {
  for (const [groupId, binding] of Object.entries(Config.bindings)) {
    if (!binding?.roomId || binding.push?.enabled !== true) continue
    const session = getSession(groupId, binding.accountUserId || "legacy")
    wireNotifications(session)
    if (session.connected && session.roomState && session.roomId === String(binding.roomId))
      continue
    try {
      await session.join(
        binding.roomId,
        String(session.api.profileNickname || Config.room.nickname || "Yunzai").slice(0, 20),
        binding.password || undefined,
        session.rejoinToken,
      )
    } catch (error) {
      logger.warn(`${Log_Prefix} 群 ${groupId} 推送会话恢复失败：${error.message}`)
    }
  }
}

const restorePushTimer = setTimeout(() => void restorePushSessions(), 2000)
restorePushTimer.unref?.()

export class MusicTogether extends plugin {
  constructor() {
    super({
      name: "一起听歌",
      dsc: "Music Together 多人同步听歌",
      event: "message",
      priority: 20,
      rule: [
        {
          reg: "^#?(?:一起听歌|音乐同听)\\s*(?:登录|登陆)(?:\\s+.*)?$",
          fnc: "handle",
          log: false,
        },
        {
          reg: "^#?(?:一起听歌|音乐同听)(?:\\s*.*)?$",
          fnc: "handle",
        },
      ],
    })
  }

  async handle(e) {
    const raw = e.msg.replace(/^#?(?:一起听歌|音乐同听)/, "").trim()
    if (!e.isGroup && !/^(?:登录|登陆)(?:\s+.*)?$/.test(raw))
      return this.reply("私聊仅支持“一起听歌登录 <账号ID> <密码>”")
    if (!raw || /^(帮助|菜单)$/.test(raw)) return this.showHelp()

    const [command, ...args] = raw.split(/\s+/)
    const rest = args.join(" ").trim()
    try {
      switch (command) {
        case "创建":
        case "新建":
          return await this.createRoom(e, rest)
        case "加入":
        case "进入":
          return await this.joinRoom(e, args)
        case "绑定":
          return await this.bindRoom(e, args)
        case "解绑":
          return await this.unbindRoom(e)
        case "搜索":
        case "搜歌":
          return await this.search(e, rest)
        case "热歌":
          return await this.hot(e, rest)
        case "推荐":
          return await this.recommend(e)
        case "歌单":
          return await this.playlist(e, args)
        case "登录":
        case "登陆":
          return await this.login(e, rest)
        case "点歌":
        case "播放":
          return await this.addTrack(e, rest)
        case "当前歌曲":
        case "当前":
        case "发歌":
        case "发送歌曲":
        case "发送当前歌曲":
        case "分享歌曲":
          return await this.currentSong(e)
        case "列表":
        case "队列":
          return await this.showQueue(e)
        case "状态":
          return await this.showStatus(e)
        case "暂停":
          return await this.control(e, EVENTS.PLAYER_PAUSE)
        case "继续":
        case "恢复":
          return await this.control(e, EVENTS.PLAYER_PLAY)
        case "下一首":
        case "下一曲":
          return await this.control(e, EVENTS.PLAYER_NEXT)
        case "上一首":
        case "上一曲":
          return await this.control(e, EVENTS.PLAYER_PREV)
        case "模式":
          return await this.setMode(e, rest)
        case "聊天":
          return await this.chat(e, rest)
        case "推送":
          return await this.setPush(e, rest)
        case "推送开启":
        case "开启推送":
          return await this.setPush(e, "开启")
        case "推送关闭":
        case "关闭推送":
          return await this.setPush(e, "关闭")
        case "推送状态":
          return await this.setPush(e, "状态")
        case "二维码":
        case "分享":
          return await this.share(e)
        case "退出":
        case "离开":
          return await this.leaveRoom(e)
        default:
          return await this.reply("未知命令，发送“一起听歌帮助”查看用法")
      }
    } catch (error) {
      logger.error(`${Log_Prefix} 命令执行失败`, error)
      return this.reply(`操作失败：${error.message || "服务端错误"}`)
    }
  }

  showHelp() {
    return this.reply(
      [
        "Music Together 一起听歌",
        "一起听歌创建 [房间名] [密码]",
        "一起听歌加入 <房间号> [密码]",
        "一起听歌搜索 [音源] <关键词>",
        "一起听歌热歌 [音源] / 推荐",
        "一起听歌歌单 <音源> <歌单ID>",
        "一起听歌登录 <账号ID> <密码>（支持私聊，每个QQ独立保存）",
        "一起听歌点歌 <序号>",
        "一起听歌当前歌曲 / 发歌 / 发送歌曲",
        "一起听歌状态 / 列表 / 暂停 / 继续 / 下一首 / 上一首",
        "一起听歌模式 <顺序|列表循环|单曲循环|随机>",
        "一起听歌聊天 <内容> / 推送 <开启|关闭|状态>",
        "一起听歌分享 / 退出",
        "绑定和解绑操作默认仅限主人",
      ].join("\n"),
    )
  }

  async createRoom(e, text) {
    if (Config.permission.bindMasterOnly && !e.isMaster)
      return this.reply("只有主人可以创建并绑定听歌房间")
    const [roomName, ...passwordParts] = text ? text.split(/\s+/) : []
    const password = passwordParts.join(" ") || undefined
    const session = getSession(groupKey(e), identityKey(e))
    wireNotifications(session)
    const created = await session.create({
      nickname: nickname(e, session.api),
      roomName: roomName || Config.room.defaultRoomName,
      password,
    })
    const roomId = created?.roomId || session.roomId
    if (!roomId) throw new Error("服务端未返回房间号")
    Config.setBinding(groupKey(e), bindingWithRoom(e, roomId, password || ""))
    return this.reply(`✅ 房间创建成功：${roomId}\n群内成员可发送“一起听歌加入 ${roomId}”进入`)
  }

  async joinRoom(e, args) {
    const roomId = args[0]
    if (!roomId) return this.reply("用法：一起听歌加入 <房间号> [密码]")
    const password = args.slice(1).join(" ") || undefined
    const session = getSession(groupKey(e), identityKey(e))
    wireNotifications(session)
    await session.join(roomId, nickname(e, session.api), password)
    Config.setBinding(groupKey(e), bindingWithRoom(e, roomId, password || ""))
    return this.reply(`✅ 已加入房间 ${roomId}`)
  }

  async bindRoom(e, args) {
    if (Config.permission.bindMasterOnly && !e.isMaster) return this.reply("只有主人可以绑定房间")
    const roomId = args[0]
    if (!roomId) return this.reply("用法：一起听歌绑定 <房间号> [密码]")
    Config.setBinding(groupKey(e), bindingWithRoom(e, roomId, args.slice(1).join(" ")))
    return this.reply(`✅ 已绑定房间 ${roomId}`)
  }

  async unbindRoom(e) {
    if (Config.permission.bindMasterOnly && !e.isMaster) return this.reply("只有主人可以解绑房间")
    const key = groupKey(e)
    closeSession(key)
    Config.removeBinding(key)
    searchCache.delete(key)
    return this.reply("✅ 已解绑并断开听歌房间")
  }

  async ensureSession(e) {
    const binding = Config.getBinding(groupKey(e))
    if (!binding?.roomId)
      throw new Error("本群尚未绑定房间，请先使用“一起听歌加入”或“一起听歌创建”")
    const session = getSession(groupKey(e), binding.accountUserId || "legacy")
    wireNotifications(session)
    if (!session.connected || !session.roomState || session.roomId !== String(binding.roomId)) {
      await session.join(
        binding.roomId,
        nickname(e, session.api),
        binding.password || undefined,
        session.rejoinToken,
      )
    }
    return session
  }

  async search(e, text) {
    if (!text) return this.reply("用法：一起听歌搜索 [音源] <关键词>")
    const parts = text.split(/\s+/)
    const maybeSource = sourceOf(parts[0])
    const source = maybeSource || Config.music.defaultSource || "netease"
    const keyword = (maybeSource ? parts.slice(1) : parts).join(" ").trim()
    if (!keyword) return this.reply("请输入搜索关键词")
    const session = await this.ensureSession(e)
    const result = await session.api.search({
      source,
      keyword,
      limit: Config.music.searchLimit,
      roomId: session.roomId,
    })
    const tracks = (result?.tracks || [])
      .map(track => normalizeTrack(track, source))
      .filter(track => track.id)
    this.cacheTracks(e, tracks)
    if (!tracks.length) return this.reply("没有找到相关歌曲")
    return this.reply(
      [
        `🔎 ${SOURCE_NAMES[source] || source}：${keyword}`,
        ...tracks.map(formatTrack),
        "发送“一起听歌点歌 序号”加入队列",
      ].join("\n"),
    )
  }

  cacheTracks(e, tracks) {
    searchCache.set(groupKey(e), {
      tracks,
      expiresAt: Date.now() + Number(Config.music.searchExpireMinutes || 5) * 60_000,
    })
  }

  async hot(e, text) {
    const source = sourceOf(text) || "netease"
    if (!["netease", "tencent", "kugou"].includes(source))
      return this.reply("热歌仅支持网易云、QQ音乐和酷狗")
    const session = await this.ensureSession(e)
    const result = await session.api.hotSongs({
      source,
      roomId: session.roomId,
      limit: Config.music.hotSongsLimit,
    })
    const tracks = (result?.tracks || [])
      .map(track => normalizeTrack(track, source))
      .filter(track => track.id)
    this.cacheTracks(e, tracks)
    if (!tracks.length) return this.reply("热歌榜暂时为空")
    return this.reply(
      [
        `🔥 ${result.name || SOURCE_NAMES[source] + "热歌榜"}`,
        ...tracks.map(formatTrack),
        "发送“一起听歌点歌 序号”加入队列",
      ].join("\n"),
    )
  }

  async recommend(e) {
    const session = await this.ensureSession(e)
    const result = await session.api.recommendations({
      roomId: session.roomId,
      limit: Config.music.searchLimit,
    })
    const tracks = (result?.recommendations || [])
      .flatMap(item => (item.tracks || []).map(track => normalizeTrack(track, item.platform)))
      .filter(track => track.id)
    this.cacheTracks(e, tracks)
    if (!tracks.length) return this.reply("暂无可用推荐，请先在 Music Together 中登录音乐平台")
    return this.reply(
      [
        "✨ 为你推荐",
        ...tracks.slice(0, 30).map(formatTrack),
        "发送“一起听歌点歌 序号”加入队列",
      ].join("\n"),
    )
  }

  async playlist(e, args) {
    const source = sourceOf(args[0])
    const id = args[1] || (source ? undefined : args[0])
    if (!id) return this.reply("用法：一起听歌歌单 <音源> <歌单ID>")
    const actualSource = source || Config.music.defaultSource || "netease"
    const session = await this.ensureSession(e)
    const result = await session.api.playlist({
      source: actualSource,
      id,
      limit: Config.music.playlistLimit,
      roomId: session.roomId,
    })
    const tracks = (result?.tracks || [])
      .map(track => normalizeTrack(track, actualSource))
      .filter(track => track.id)
    if (!tracks.length) return this.reply("歌单为空或无法读取")
    session.send(EVENTS.QUEUE_ADD_BATCH, { tracks, playlistName: result?.name || id })
    return this.reply(`✅ 已将歌单加入队列：${tracks.length} 首`)
  }

  async login(e, text) {
    if (e.isGroup && Config.permission.authMasterOnly && !e.isMaster)
      return this.reply("只有主人可以登录 Music Together 账号")
    const parts = text.trim().split(/\s+/)
    const accountId = parts.shift()
    const password = parts.join(" ")
    if (!accountId || !password) return this.reply("用法：一起听歌登录 <账号ID> <密码>")

    const userIdentityKey = identityKey(e)
    const api = getMTApi(userIdentityKey)
    const result = await api.recoverIdentity(accountId, password)
    const profile = await api.getProfile().catch(() => null)
    await reconnectSessionsForIdentity(userIdentityKey)

    if (e.isGroup) {
      const key = groupKey(e)
      const binding = Config.getBinding(key)
      if (binding?.roomId) {
        Config.setBinding(key, { ...binding, accountUserId: userIdentityKey })
        closeSession(key)
        const session = getSession(key, userIdentityKey)
        wireNotifications(session)
        await session.join(
          binding.roomId,
          profile?.nickname || api.profileNickname || Config.room.nickname || "Yunzai",
          binding.password || undefined,
        )
      }
    }
    const name = profile?.nickname ? `（${profile.nickname}）` : ""
    const scope = e.isGroup
      ? "当前群已切换为此账号，登录状态按你的QQ独立保存"
      : "登录状态已按你的QQ独立保存；回群后由你执行加入、创建或登录即可使用此账号"
    return this.reply(
      `✅ Music Together 账号登录成功${name}\n账号：${result?.userId || accountId}\n${scope}`,
    )
  }

  async addTrack(e, value) {
    const index = Number.parseInt(value, 10)
    if (!Number.isInteger(index) || index < 1)
      return this.reply("请先搜索，再使用“一起听歌点歌 序号”")
    const cached = searchCache.get(groupKey(e))
    if (!cached || cached.expiresAt < Date.now()) return this.reply("搜索结果已过期，请重新搜索")
    const track = cached.tracks[index - 1]
    if (!track) return this.reply("序号不存在，请重新搜索")
    const session = await this.ensureSession(e)
    session.send(EVENTS.QUEUE_ADD, { track })
    return this.reply(`✅ 已点歌：${track.title}`)
  }

  async currentSong(e) {
    const session = await this.ensureSession(e)
    const track = session.roomState?.currentTrack
    if (!track) return this.reply("当前没有正在播放的歌曲")
    const artists = Array.isArray(track.artist)
      ? track.artist.join("、")
      : String(track.artist || "未知歌手")
    const lines = [
      `🎵 当前歌曲：${track.title}`,
      `歌手：${artists}`,
      `专辑：${track.album || "未知专辑"}`,
      `音源：${SOURCE_NAMES[track.source] || track.source}`,
      `房间：${session.roomId}`,
    ]
    const cover = track.cover || track.thumbnailCover
    const songInfo = lines.join("\n")
    const infoResult = await this.reply(cover ? [songInfo, segment.image(cover)] : songInfo)
    if (replyFailed(infoResult) && cover) await this.reply(songInfo)

    let audioFile
    try {
      audioFile = await this.downloadCurrentAudio(track, session.roomId, session.api)
      const localResult = await this.reply(segment.record(audioFile))
      if (!replyFailed(localResult)) return true
      throw new Error(replyError(localResult))
    } catch (error) {
      logger.error(`${Log_Prefix} 当前歌曲音频发送失败`, error)
      await this.reply(
        `⚠️ 歌曲信息已发送，但音频发送失败：${error.message || "协议端不支持该音频"}`,
      )
      return true
    } finally {
      if (audioFile) await unlink(audioFile).catch(() => {})
    }
  }

  async downloadCurrentAudio(track, roomId, api) {
    const response = await api.download({ roomId, trackId: String(track.id), quality: 128 })
    if (!response.body) throw new Error("Music Together 返回了空音频")
    await mkdir(audioTempDir, { recursive: true })
    const file = path.join(audioTempDir, `${randomUUID()}${audioExtension(response)}`)
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file))
      return file
    } catch (error) {
      await unlink(file).catch(() => {})
      throw error
    }
  }

  async showQueue(e) {
    const session = await this.ensureSession(e)
    const queue = session.roomState?.queue || []
    if (!queue.length) return this.reply("当前播放列表为空")
    return this.reply(
      [
        `🎶 房间 ${session.roomId} 播放列表`,
        ...queue.slice(0, 30).map(formatTrack),
        queue.length > 30 ? `……共 ${queue.length} 首` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  async showStatus(e) {
    const session = await this.ensureSession(e)
    const state = session.roomState || {}
    const track = state.currentTrack
    const now = track ? `${track.title} - ${(track.artist || []).join("、")}` : "暂无播放"
    return this.reply(
      `🎧 ${state.name || "一起听歌"} (${session.roomId})\n当前：${now}\n模式：${PLAY_MODE_NAMES[state.playMode] || state.playMode || "列表循环"}\n在线成员：${state.users?.length || 0} 人`,
    )
  }

  async control(e, event) {
    const session = await this.ensureSession(e)
    if (
      Config.permission.controlGroupAdmin &&
      !e.isMaster &&
      !e.member?.is_admin &&
      !e.member?.is_owner
    )
      return this.reply("当前配置要求群管理员才能控制播放")
    const role = session.roomState?.users?.find(
      user => user.id === session.api.identityUserId,
    )?.role
    const voteAction = {
      [EVENTS.PLAYER_PAUSE]: "pause",
      [EVENTS.PLAYER_PLAY]: "resume",
      [EVENTS.PLAYER_NEXT]: "next",
      [EVENTS.PLAYER_PREV]: "prev",
    }[event]
    if (role === "member" && voteAction) session.send(EVENTS.VOTE_START, { action: voteAction })
    else session.send(event)
    const labels = {
      [EVENTS.PLAYER_PAUSE]: "已暂停",
      [EVENTS.PLAYER_PLAY]: "已继续",
      [EVENTS.PLAYER_NEXT]: "已切到下一首",
      [EVENTS.PLAYER_PREV]: "已切到上一首",
    }
    return this.reply(`✅ ${role === "member" ? "已发起投票" : labels[event] || "操作已发送"}`)
  }

  async setMode(e, text) {
    const mode = PLAY_MODE_ALIAS[text] || text
    if (!PLAY_MODE_NAMES[mode])
      return this.reply(`可用模式：${Object.values(PLAY_MODE_NAMES).join("、")}`)
    const session = await this.ensureSession(e)
    if (
      Config.permission.controlGroupAdmin &&
      !e.isMaster &&
      !e.member?.is_admin &&
      !e.member?.is_owner
    )
      return this.reply("当前配置要求群管理员才能切换模式")
    const role = session.roomState?.users?.find(
      user => user.id === session.api.identityUserId,
    )?.role
    if (role === "member")
      session.send(EVENTS.VOTE_START, { action: "set-mode", payload: { mode } })
    else session.send(EVENTS.PLAYER_SET_MODE, { mode })
    return this.reply(
      `✅ ${role === "member" ? "已发起模式切换投票" : `播放模式：${PLAY_MODE_NAMES[mode]}`}`,
    )
  }

  async chat(e, text) {
    if (!text) return this.reply("用法：一起听歌聊天 <内容>")
    const session = await this.ensureSession(e)
    session.send(EVENTS.CHAT_MESSAGE, { content: text.slice(0, 500) })
    return true
  }

  async setPush(e, action) {
    const key = groupKey(e)
    const binding = Config.getBinding(key)
    if (!binding?.roomId) return this.reply("本群尚未绑定房间，请先加入或创建一起听歌房间")

    const normalized = String(action || "状态")
      .trim()
      .toLowerCase()
    const enableActions = new Set(["开启", "打开", "启用", "开", "on", "true", "1"])
    const disableActions = new Set(["关闭", "关掉", "停用", "关", "off", "false", "0"])

    if (!enableActions.has(normalized) && !disableActions.has(normalized)) {
      const enabled = binding.push?.enabled === true
      return this.reply(
        `当前群一起听歌推送：${enabled ? "已开启" : "已关闭"}\n推送内容：播放歌曲、房间聊天${Config.chat.notifyUserChange ? "、成员进出" : ""}`,
      )
    }

    if (Config.permission.bindMasterOnly && !e.isMaster)
      return this.reply("只有主人可以修改当前群的一起听歌推送")

    const enabled = enableActions.has(normalized)
    if (binding.push?.enabled === enabled)
      return this.reply(`当前群一起听歌推送已经${enabled ? "开启" : "关闭"}`)

    if (enabled) {
      const session = await this.ensureSession(e)
      savePushEnabled(key, true)
      if (session.roomState?.currentTrack)
        await pushToGroup(key, trackPushMessage(session.roomState.currentTrack))
    } else {
      savePushEnabled(key, false)
    }

    return this.reply(`✅ 当前群一起听歌推送已${enabled ? "开启" : "关闭"}`)
  }

  async share(e) {
    const session = await this.ensureSession(e)
    const result = await session.api.roomShareQr(session.roomId)
    if (result?.qrimg)
      return this.reply([`房间 ${session.roomId} 分享二维码`, segment.image(result.qrimg)])
    return this.reply(result?.url || result?.link || `房间号：${session.roomId}`)
  }

  async leaveRoom(e) {
    const binding = Config.getBinding(groupKey(e))
    const session = getSession(groupKey(e), binding?.accountUserId || "legacy")
    session.leave()
    return this.reply("✅ 已退出听歌房间（绑定仍保留，可再次进入）")
  }
}

export default MusicTogether
