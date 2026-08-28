# Music Together 后端接口文档

服务端为 Express + 原生 WebSocket（JSON 信封协议）。身份认证基于 `httpOnly` Cookie：先调用身份引导接口签发凭据，后续请求自动携带并滑动续期。

> 错误响应统一为 `{ "error": "错误描述" }`；`/api/admin/*` 除首次初始化端点外全部要求服务器管理员身份（`SERVER_ADMIN_IDS` 或账号角色为 `admin`），否则返回 403。

## 一、认证与账户（/api/auth）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/identity/bootstrap` | 签发/续期身份 Cookie，返回 204，经 `X-Identity-UserId`、`X-Identity-Expires-At` 响应头返回元数据 |
| POST | `/identity/logout` | 注销并换发新的匿名身份，返回 `{ userId, expiresAt }` |
| POST | `/identity/recover` | 账号 ID + 密码找回登录，请求体 `{ accountId, password }`，返回 `{ userId, expiresAt }` |
| GET | `/me` | 当前用户资料 `{ id, nickname, avatarUrl, hasPassword, role }`；无资料返回 204 |
| PATCH | `/me` | 修改昵称，请求体 `{ nickname }` |
| POST | `/me/password` | 首次设置密码（≥8 位，已有密码返回 409），请求体 `{ password }` |
| POST | `/me/avatar` | 上传头像（Base64 图片，≤5MB，服务端压缩为 256×256 WebP），请求体 `{ image }` |
| PATCH | `/me/account-id` | 修改账号 ID；有密码时需 `currentPassword` 验证，请求体 `{ accountId, currentPassword? }` |

## 二、音乐（/api/music）

均受元数据限流保护；涉及房间身份的接口要求调用者是该房间成员。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/search` | 搜索，参数 `source`（netease/tencent/kugou/bilibili）、`keyword`、`limit`、`page`、`type`（song/album/playlist）、`roomId?` |
| GET | `/playlist` | 歌单分页，参数 `source`、`id`、`limit`、`offset`、`total`、`roomId?`、`type?` |
| GET | `/hot` | 各平台热歌榜，参数 `roomId`、`source`、`limit`、`offset`、`refresh?` |
| GET | `/recommendations` | 已登录平台个性化推荐，参数 `roomId`、`platform?`、`limit?`、`radarPage?` 等 |
| GET | `/bilibili-collection` | B 站视频合集，参数 `bvid` |
| GET | `/url` | 播放流地址，参数 `source`、`urlId`、`bitrate` |
| GET | `/lyric` | 歌词，参数 `source`、`lyricId` |
| GET | `/lyric-supplement` | 歌词补充（翻译/罗马音） |
| GET | `/cover` | 封面图地址，参数 `source`、`picId`、`size` |
| GET | `/download-options` | 当前曲目下载选项，参数 `roomId`、`trackId`（曲目切换返回 409） |
| GET | `/download` | 流式下载，参数 `roomId`、`trackId`、`quality` |
| GET | `/cover-proxy` | 封面图代理（绕过外部 CDN CORS，白名单域名），参数 `url` |
| GET | `/bilibili-audio-proxy` | B 站音频 CDN 字节范围代理 |
| GET | `/kugou-audio-proxy` | 酷狗音频字节范围代理 |

## 三、房间（/api/rooms）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/:roomId/check` | 房间预检 `{ exists, hasPassword, name, userCount }`（加入前门控用） |
| GET | `/:roomId/share/qr` | 邀请链接二维码（data URL），参数 `link` |

## 四、后台管理（/api/admin）

### 首次初始化（公开端点，仅在服务器尚无管理员时可用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/setup-status` | `{ needed }`：是否需要首次初始化（数据库无 `admin` 角色且未配置 `SERVER_ADMIN_IDS`） |
| POST | `/setup` | 创建首个管理员，请求体 `{ accountId, nickname, password }`；成功后直接签发身份 Cookie；已初始化/保留 ID/账号冲突分别返回 409/400/409 |

### 管理端点（需服务器管理员身份）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/users` | 账号列表（含角色、密码状态、注册/活跃时间） |
| DELETE | `/users/:userId` | 删除账号（禁止删除自己） |
| POST | `/users/:userId/reset-password` | 重置密码，请求体 `{ password }`（≥8 位） |
| GET | `/users/:userId/platform-auths` | 用户平台授权列表（脱敏：平台/昵称/会员标签，不含 Cookie） |
| DELETE | `/users/:userId/platform-auths/:platform` | 解除指定平台授权；非法平台 400，用户或授权不存在 404 |
| GET | `/overview` | 系统概览：单次返回 `{ version, healthy, users, rooms }` |
| GET | `/rooms` | 活跃房间列表（含隐藏房间与正在播放曲目） |
| GET | `/rooms/:roomId` | 房间详情：播放状态、当前曲目、队列与成员名册（含离线成员） |
| POST | `/rooms/:roomId/kick/:userId` | 将成员移出房间（断开其全部连接并清理离线名册），成功 204 |
| POST | `/rooms/:roomId/dissolve` | 解散房间 |
| GET / PATCH | `/audio-proxy-policy` | 音频代理策略 `{ kugouForceProxy }` |
| GET / PATCH | `/backup-settings` | 备份设置 `{ enabled, cleanupEnabled, intervalHours(1-8760), retentionDays(1-3650) }` |
| GET | `/backups` | 备份文件列表 `{ backups: [{ name, createdAt, includesEnvFile }], running }` |
| POST | `/backups/run` | 立即创建备份，返回 `{ name }`；已有备份进行中返回 409 |
| DELETE | `/backups/:name` | 删除指定备份；非法名称 400，不存在 404 |
| GET | `/background` | 全局背景设置 |
| POST | `/background` | 设置背景图，请求体 `{ image }`（Base64 ≤6MB）或 `{ imageUrl }` 二选一 |
| PATCH | `/background` | 背景显示设置 `{ glassOverlay?, colorPreset?, backgroundBrightness(20-100)?, autoTint?, coverAutoTint? }` |
| DELETE | `/background` | 移除背景图 |

## 五、公共与静态资源

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings/background` | 公开的全局背景设置（无需登录） |
| GET | `/api/health` | 健康检查 `{ status, timestamp }` |
| GET | `/api/version` | 服务版本 `{ version }` |
| 静态 | `/uploads/avatars/*` | 用户头像 |
| 静态 | `/uploads/backgrounds/*` | 全局背景图 |

## 六、WebSocket 实时协议（/ws）

消息为 JSON 信封：`{ "event": "<事件名>", "data": <载荷> }`。播放时间线以服务端为权威。

### 客户端 → 服务端

| 事件 | 载荷 | 说明 |
|---|---|---|
| `room:create` | `{ nickname, roomName?, password? }` | 创建房间 |
| `room:join` | `{ roomId, nickname, password?, rejoinToken? }` | 加入房间 |
| `room:leave` | — | 离开房间 |
| `room:list` | — | 请求房间列表 |
| `room:settings` | `{ name?, password?, audioQuality?, hidden?, permanent?, ... }` | 修改房间设置 |
| `room:set_role` | `{ userId, role }` | 设置成员角色 |
| `player:play` | `{ track? }` | 播放（可携带曲目） |
| `player:pause` / `player:seek` | `{ currentTime }` | 暂停 / 拖动 |
| `player:next` / `player:prev` | — | 切歌 |
| `player:sync` / `player:sync_request` | `{ currentTime, hostServerTime? }` | 播放进度同步 |
| `player:set_mode` | `{ mode }` | 播放模式（顺序/列表循环/单曲循环/随机） |
| `queue:add` / `queue:add_batch` / `queue:insert_after_current` | `{ track }` / `{ tracks, playlistName? }` | 队列添加 |
| `queue:remove` / `queue:reorder` / `queue:clear` | `{ trackId }` / `{ trackIds }` | 队列管理 |
| `queue:update_metadata` | `{ trackId, lyricId?, picId?, ... }` | 更新曲目元数据 |
| `chat:message` | `{ content }` | 发送聊天 |
| `vote:start` / `vote:cast` | `{ action, payload? }` / `{ approve }` | 投票 |
| `ntp:ping` | `{ clientPingId, lastRttMs? }` | 时钟同步 |
| `auth:request_qr` / `auth:check_qr` | `{ platform, key? }` | 平台扫码登录 |
| `auth:set_cookie` / `auth:logout` | `{ platform, cookie?, persist? }` | 平台 Cookie 管理 |
| `auth:get_status` | — | 查询平台登录状态 |
| `playlist:get_my` | `{ platform }` | 获取我的歌单 |

### 服务端 → 客户端

| 事件 | 说明 |
|---|---|
| `room:state` / `room:created` / `room:error` | 房间状态 / 创建成功 / 错误 |
| `room:user_joined` / `room:user_left` / `room:role_changed` | 成员变化 |
| `room:settings` / `room:list_update` / `room:rejoin_token` / `room:auto_fallback` | 房间设置 / 列表 / 重连令牌 / 自动回退 |
| `player:play` / `player:pause` / `player:resume` / `player:seek` | 播放控制广播（含服务端计划时间） |
| `player:sync_response` | `{ currentTime, isPlaying, serverTimestamp, trackId? }` |
| `player:track_metadata_updated` | 曲目元数据更新 |
| `queue:updated` | 队列全量更新 |
| `chat:message` / `chat:history` | 聊天消息 / 历史 |
| `vote:started` / `vote:result` | 投票开始 / 结果 |
| `ntp:pong` | 时钟同步响应 |
| `auth:qr_generated` / `auth:qr_status` / `auth:set_cookie_result` | 平台登录流程 |
| `auth:status_update` / `auth:my_status` | 平台登录状态 |
| `playlist:my_list` | 我的歌单列表 |
| `server:audio_proxy_policy` / `server:global_background` | 管理端策略/背景变更广播 |
