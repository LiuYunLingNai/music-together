import path from "node:path"
import { fileURLToPath } from "node:url"

const _filename = fileURLToPath(import.meta.url)
const _dirname = path.dirname(_filename)

/** 插件名 */
export const Plugin_Name = "music-together-plugin"
/** 插件根目录 */
export const Plugin_Path = path.join(_dirname, "..")
/** Yunzai 根目录 */
export const Yunzai_Path = process.cwd()
/** 日志前缀 */
export const Log_Prefix = "[一起听歌]"
/** 插件版本 */
export const Version = "1.0.0"

/** 服务端事件常量，与 music-together packages/shared/src/events.ts 保持一致 */
export const EVENTS = {
  SERVER_AUDIO_PROXY_POLICY: "server:audio_proxy_policy",
  SERVER_GLOBAL_BACKGROUND: "server:global_background",

  ROOM_CREATE: "room:create",
  ROOM_CREATED: "room:created",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_STATE: "room:state",
  ROOM_REJOIN_TOKEN: "room:rejoin_token",
  ROOM_USER_JOINED: "room:user_joined",
  ROOM_USER_LEFT: "room:user_left",
  ROOM_SETTINGS: "room:settings",
  ROOM_ERROR: "room:error",
  ROOM_AUTO_FALLBACK: "room:auto_fallback",
  ROOM_LIST: "room:list",
  ROOM_LIST_UPDATE: "room:list_update",
  ROOM_SET_ROLE: "room:set_role",
  ROOM_ROLE_CHANGED: "room:role_changed",

  PLAYER_PLAY: "player:play",
  PLAYER_PAUSE: "player:pause",
  PLAYER_RESUME: "player:resume",
  PLAYER_SEEK: "player:seek",
  PLAYER_NEXT: "player:next",
  PLAYER_PREV: "player:prev",
  PLAYER_SYNC: "player:sync",
  PLAYER_SYNC_REQUEST: "player:sync_request",
  PLAYER_SYNC_RESPONSE: "player:sync_response",
  PLAYER_SET_MODE: "player:set_mode",
  PLAYER_TRACK_METADATA_UPDATED: "player:track_metadata_updated",

  QUEUE_ADD: "queue:add",
  QUEUE_ADD_BATCH: "queue:add_batch",
  QUEUE_INSERT_AFTER_CURRENT: "queue:insert_after_current",
  QUEUE_REMOVE: "queue:remove",
  QUEUE_REORDER: "queue:reorder",
  QUEUE_UPDATE_METADATA: "queue:update_metadata",
  QUEUE_CLEAR: "queue:clear",
  QUEUE_UPDATED: "queue:updated",

  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",

  VOTE_START: "vote:start",
  VOTE_STARTED: "vote:started",
  VOTE_CAST: "vote:cast",
  VOTE_RESULT: "vote:result",

  NTP_PING: "ntp:ping",
  NTP_PONG: "ntp:pong",

  AUTH_REQUEST_QR: "auth:request_qr",
  AUTH_QR_GENERATED: "auth:qr_generated",
  AUTH_CHECK_QR: "auth:check_qr",
  AUTH_QR_STATUS: "auth:qr_status",
  AUTH_SET_COOKIE: "auth:set_cookie",
  AUTH_SET_COOKIE_RESULT: "auth:set_cookie_result",
  AUTH_LOGOUT: "auth:logout",
  AUTH_STATUS_UPDATE: "auth:status_update",
  AUTH_MY_STATUS: "auth:my_status",
  AUTH_GET_STATUS: "auth:get_status",
  AUTH_CLAIM_KUGOU_CONCEPT_VIP: "auth:claim_kugou_concept_vip",
  AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT: "auth:claim_kugou_concept_vip_result",

  PLAYLIST_GET_MY: "playlist:get_my",
  PLAYLIST_MY_LIST: "playlist:my_list",
}

/** 服务端约束，与 packages/shared/src/constants.ts 保持一致 */
export const LIMITS = {
  ROOM_PASSWORD_MAX_LENGTH: 32,
  ROOM_NAME_MAX_LENGTH: 30,
  NICKNAME_MAX_LENGTH: 20,
  CHAT_CONTENT_MAX_LENGTH: 500,
  CHAT_RATE_LIMIT_PER_SECOND: 5,
  QUEUE_MAX_SIZE: 1000,
  QUEUE_BATCH_MAX_SIZE: 200,
  PLAYLIST_PAGE_SIZE: 100,
  SEARCH_KEYWORD_MAX_LENGTH: 100,
  BILIBILI_SEARCH_INPUT_MAX_LENGTH: 2000,
  SEARCH_PAGE_SIZE_MAX: 50,
  SEARCH_PAGE_MAX: 100,
  PLAYLIST_ID_MAX_LENGTH: 200,
  ROOM_ID_MAX_LENGTH: 10,
}

export const TIMING = {
  WEBSOCKET_HEARTBEAT_INTERVAL_MS: 25_000,
  VOTE_TIMEOUT_MS: 30_000,
  ROOM_GRACE_PERIOD_MS: 60_000,
}

export const QR_STATUS = {
  EXPIRED: 800,
  WAITING_SCAN: 801,
  SCANNED: 802,
  SUCCESS: 803,
}

/** 音源枚举 */
export const MUSIC_SOURCES = ["netease", "tencent", "kugou", "kugou_concept", "bilibili"]
export const HOT_SONGS_SOURCES = ["netease", "tencent", "kugou"]

/** 音源中文名 */
export const SOURCE_NAMES = {
  netease: "网易云",
  tencent: "QQ音乐",
  kugou: "酷狗",
  kugou_concept: "酷狗概念版",
  bilibili: "哔哩哔哩",
}

/** 音源别名，用于命令解析 */
export const SOURCE_ALIAS = {
  网易: "netease",
  网易云: "netease",
  wy: "netease",
  netease: "netease",
  qq: "tencent",
  QQ: "tencent",
  qq音乐: "tencent",
  腾讯: "tencent",
  tencent: "tencent",
  酷狗: "kugou",
  kg: "kugou",
  kugou: "kugou",
  概念版: "kugou_concept",
  酷狗概念版: "kugou_concept",
  kugou_concept: "kugou_concept",
  b站: "bilibili",
  B站: "bilibili",
  哔哩哔哩: "bilibili",
  bili: "bilibili",
  bilibili: "bilibili",
}

/** 播放模式中文名 */
export const PLAY_MODE_NAMES = {
  sequential: "顺序播放",
  "loop-all": "列表循环",
  "loop-one": "单曲循环",
  shuffle: "随机播放",
}

export const PLAY_MODE_ALIAS = {
  顺序: "sequential",
  顺序播放: "sequential",
  列表循环: "loop-all",
  循环: "loop-all",
  单曲循环: "loop-one",
  单曲: "loop-one",
  随机: "shuffle",
  随机播放: "shuffle",
}

/** 投票动作中文名 */
export const VOTE_ACTION_NAMES = {
  pause: "暂停播放",
  resume: "继续播放",
  next: "切下一首",
  prev: "切上一首",
  "set-mode": "切换播放模式",
  "play-track": "播放指定歌曲",
  "remove-track": "移除指定歌曲",
}

/** 角色中文名 */
export const ROLE_NAMES = {
  owner: "房主",
  admin: "管理员",
  member: "成员",
}

/** 错误码中文提示 */
export const ERROR_MESSAGES = {
  INVALID_INPUT: "参数不合法",
  INVALID_DATA: "数据格式错误",
  INTERNAL: "服务端内部错误",
  ROOM_NOT_FOUND: "房间不存在",
  WRONG_PASSWORD: "房间密码错误",
  JOIN_FAILED: "加入房间失败",
  NOT_IN_ROOM: "当前不在房间内",
  NOT_OWNER: "只有房主可以操作",
  NO_PERMISSION: "权限不足",
  SET_ROLE_FAILED: "设置角色失败",
  QUEUE_FULL: "播放队列已满",
  STREAM_FAILED: "获取播放地址失败",
  RATE_LIMITED: "操作过于频繁",
  NO_VOTE_NEEDED: "当前无需发起投票",
  VOTE_IN_PROGRESS: "已有投票正在进行",
  ALREADY_VOTED: "你已经投过票了",
  KICKED_BY_ADMIN: "已被管理员移出房间",
  UNAUTHENTICATED: "身份凭据无效，请检查服务端地址",
}

export default {
  Plugin_Name,
  Plugin_Path,
  Yunzai_Path,
  Log_Prefix,
  Version,
  EVENTS,
  LIMITS,
  TIMING,
  QR_STATUS,
  MUSIC_SOURCES,
  HOT_SONGS_SOURCES,
  SOURCE_NAMES,
  SOURCE_ALIAS,
  PLAY_MODE_NAMES,
  PLAY_MODE_ALIAS,
  VOTE_ACTION_NAMES,
  ROLE_NAMES,
  ERROR_MESSAGES,
}
