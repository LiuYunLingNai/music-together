# Music Together Android 项目速查手册

> 供开发者和 AI 助手快速理解 Android 分支的项目结构与关键数据流。

## 1. 项目概览

Music Together Android 是 Music Together 的原生 Android 客户端。应用连接兼容的 Music Together 服务端，在 Android 设备上提供多服务器房间大厅、同步播放、聊天、队列、平台账号和逐词歌词。

当前分支不包含 Web 客户端、服务端或共享 TypeScript 包。相关源码位于仓库的 `main` 分支，上游项目说明见 [Yueby/music-together 项目速查手册](https://github.com/Yueby/music-together/blob/main/docs/PROJECT_ARCHITECTURE.md)。

### 核心功能

Android 客户端包含以下主要能力：

| 功能 | 说明 |
| --- | --- |
| 多服务器大厅 | 同时连接多个服务端并聚合房间列表 |
| 房间系统 | 创建、加入、密码房间、隐藏房间、离开和断线重进 |
| 同步播放 | 服务端校时、计划执行、进度上报和漂移修正 |
| 房间互动 | 队列、聊天、成员权限、播放模式和投票 |
| 多音源 | 网易云音乐、QQ 音乐、酷狗音乐、酷狗概念版和 B 站 |
| 平台账号 | 扫码或 Cookie 登录、歌单、收藏夹和音质权限 |
| 歌词 | TTML、YRC、LRC、逐词歌词、翻译、音译、Ruby 和本地偏移 |
| Android 集成 | ExoPlayer、MediaSession、媒体通知和应用内更新 |

### 技术栈

当前工程配置如下：

| 项目 | 当前配置 |
| --- | --- |
| 语言 | Kotlin 2.4.10，Java Virtual Machine (JVM) 17 |
| 构建 | Gradle 9.5.0，Android Gradle Plugin 9.3.1 |
| Android | `minSdk 26`，`targetSdk 36`，`compileSdk 37` |
| 用户界面 | Jetpack Compose，Material 3，MIUIX 0.9.3 |
| 网络 | OkHttp 4.12，HTTP API，原生 WebSocket |
| 播放 | Media3 ExoPlayer，MediaSessionService |
| 图片与取色 | Coil 3，AndroidX Palette |
| 状态 | Kotlin Flow，Compose State |
| 测试 | JUnit 4 JVM 单元测试 |

## 2. 目录结构

Android 客户端的构建、源码和测试文件集中在 `packages/android-client/`。

```text
music-together/
├── .github/workflows/android.yml
├── AGENTS.md
├── docs/
│   └── PROJECT_ARCHITECTURE.md
├── README.md
└── packages/android-client/
    ├── app/
    │   ├── build.gradle.kts
    │   └── src/
    │       ├── main/
    │       │   ├── AndroidManifest.xml
    │       │   ├── java/io/github/yueby/musictogether/
    │       │   └── res/
    │       └── test/java/io/github/yueby/musictogether/
    ├── build.gradle.kts
    ├── gradle/
    ├── gradle.properties
    ├── gradlew
    ├── gradlew.bat
    └── settings.gradle.kts
```

### Kotlin 源码

Kotlin 入口和功能包位于应用主命名空间：

```text
io/github/yueby/musictogether/
├── account/
├── MainActivity.kt
├── MusicTogetherViewModel.kt
├── logging/
├── lyrics/
├── model/
├── network/
├── notifications/
├── player/
├── queue/
├── settings/
├── offline/
├── updates/
└── ui/
    ├── designsystem/
    └── player/
```

| 路径 | 内容 |
| --- | --- |
| `MainActivity.kt` | 应用入口、主题和 Compose 挂载 |
| `MusicTogetherViewModel.kt` | 应用状态、主 WebSocket 事件和业务模块编排 |
| `account/` | 身份资料、头像、密码和管理员操作流程 |
| `model/` | 房间、曲目、歌词、账号和界面状态 |
| `network/` | 服务端连接、协议转换和多服务器房间发现 |
| `player/` | 后台播放、系统媒体控制和同步 |
| `queue/` | 点歌操作的乐观占用、去重和服务端确认 |
| `settings/` | 应用本地设置、房间重进凭据和平台凭据 |
| `offline/` | 已下载歌曲的索引、应用私有音频文件和下载流程 |
| `updates/` | 应用更新检查、下载校验和安装流程 |
| `lyrics/` | 歌词解析和 Apple Music-like Lyrics (AMLL) 数据处理 |
| `ui/` | 大厅、房间、设置、账号和平台界面 |
| `ui/designsystem/` | Material 3 / MIUIX 主题桥接、风格感知的公共组件和运行时风格选择器 |
| `ui/player/` | 播放器布局与歌词绘制 |
| `notifications/` | 聊天通知 |
| `logging/` | Debug 日志记录与导出 |

## 3. 架构与数据流

应用采用单 Activity、Compose 界面、ViewModel 编排和 MediaSession 后台播放的结构。

```text
MainActivity
  -> MusicTogetherApp
    -> LobbyScreen / RoomScreen
      -> RoomHeader / Room panes / Settings / Player

UI 操作
  -> MusicTogetherViewModel
    -> AccountCoordinator / QueueActionTracker / AppUpdateCoordinator
    -> DiscoveryConnectionCoordinator / MusicTogetherApi / MusicTogetherSocket
    -> AppPreferences
    -> NativePlayer
      -> MediaController
        -> PlaybackService
          -> ExoPlayer + MediaSession

服务端事件
  -> MusicTogetherSocket
    -> MusicTogetherViewModel.handleEvent()
      -> AppState / NativePlayer
        -> Compose UI
```

### 应用状态

`MusicTogetherViewModel` 持有 `StateFlow<AppState>`，并作为 Compose 使用的统一操作门面。账号、队列待确认状态、应用更新、本地设置和多服务器发现分别由独立协调组件管理；这些组件通过显式状态变换回调更新 `AppState`，不直接持有第二份应用状态。

`AppState` 包含服务器、房间、账号、搜索、平台推荐、当前歌曲下载、歌词、平台中心、界面风格、主题模式、底栏与播放器显示设置、同步设置、服务端音频代理策略和应用更新状态。界面和播放器偏好由 `AppPreferences` 持久化，切换时只替换 Compose 表现层，不重建 ViewModel、网络连接或播放会话。平台推荐、完整歌单加载、下载选项和文件下载分别使用可取消任务；切换歌单或歌曲、离开房间及释放 ViewModel 时取消对应旧任务。旧服务端没有代理策略事件时，酷狗默认强制代理。

已下载歌曲由统一离线索引关联曲目元数据和可播放 URI：应用私有下载与 Android 公共 Download 目录中的系统保存文件都会写入该索引，旧版公共下载会在启动时迁移。下载请求沿用当前播放目标和平台请求头策略，B 站及需要代理的酷狗资源下载服务器可播放版本。房间播放曲目时先查询离线索引，命中后仍按房间的同步时间、计划操作和漂移校正播放本地文件；未命中时继续使用网络资源。主页的本地音乐页只在未加入房间时启动本地播放，避免与房间同步播放意图冲突。

播放器通过独立的 `StateFlow<PlayerUiState>` 发布当前曲目、播放状态、进度、时长、缓冲和错误。Compose 页面同时收集两个状态流。

### 界面入口

`MusicTogetherApp.kt` 根据房间状态显示 `LobbyScreen` 或 `RoomScreen`。`RoomScreen.kt` 负责房间整体布局和面板切换，具体内容分布在以下文件：

`MainActivity.kt` 在 Compose 根节点读取持久化的 `UiStyle`、主题模式、MIUIX 纯黑背景和显示偏好，并通过 `MusicTogetherTheme` 同时提供 Material 3 与 MIUIX 色彩上下文。主题支持跟随系统、浅色与深色；Android 12 及以上可选系统动态色。纯黑背景是 MIUIX 深色模式的独立偏好，不改变 Material 3 外观。MIUIX 主题同时向仍在复用的 Material 控件映射可读的背景、内容、轮廓与强调色，避免迁移期间出现低对比度文字或弹层割裂。风格感知组件只依赖 `LocalUiStyle` 和统一状态：Material 3 模式保留原有组件，MIUIX 模式使用对应的原生 MIUIX 容器与导航。业务页面不得因为风格切换复制网络、播放器或状态逻辑；新增双风格组件应优先放入 `ui/designsystem/`，再由页面组合使用。

设置首页只承担分类导航，账号、服务器连接、外观与个性化、播放器、播放与同步、存储与更新、管理员入口分别进入二级页面；进入任意二级页后隐藏底部导航，返回设置首页时恢复。页面之间使用即时切换，系统返回只负责返回栈语义；在连续动效达到可发布质量前，不提供实验性页面过渡或对应设置项。Material 3 固定使用标准导航栏，不展示 MIUIX 专属的底栏样式和玻璃效果选项；MIUIX 可在标准底栏与 iOS 风格液态悬浮胶囊之间切换。`BottomDock` 统一拥有系统导航栏 Insets、导航胶囊、迷你播放器附件和页面底部占位，禁止页面使用固定偏移分别定位这些元素。iOS 悬浮导航直接沿用 MIUIX `v0.9.3` 官方示例的 Apache-2.0 实现：外层为 64 dp 胶囊，并保留阻尼拖动、橡皮筋位移、双 Backdrop、折射、色散、设备倾斜高光、RTL 与无障碍语义。有迷你播放器时，播放器与导航胶囊位于同一高度、等分可用宽度，播放器切换为仅保留圆形封面和必要操作的紧凑形态，导航选中透镜限制为不超过标签槽宽的圆形；两侧共用相同的背景采样、模糊、折射、混色和外层胶囊半径。没有迷你播放器时导航胶囊占完整 Dock 宽度。主页内容延伸至悬浮 Dock 后方并用滚动内容 Padding 保证末项可达，禁止用不透明底部占位制造黑色条带。实时光学效果不可用或用户关闭玻璃效果时，仍使用官方实色 iOS 胶囊路径，不切换到 Material 组件，也不自行发明另一套降级外观。

MIUIX 设置二级页使用 MIUIX `Scaffold` 与 `SmallTopAppBar` 消费状态栏和横向安全区，列表只消费 Scaffold 返回的内容 Padding；页面 Scaffold、顶栏、系统栏衔接区和底部 Dock 后方必须读取同一个解析后页面背景，纯黑开关关闭时不得由 `surface` 默认值重新引入局部纯黑。自定义卡片内容必须保留不受圆角裁剪的内边距，不得用页面级圆角裁剪正文。播放器可见控件经 `PlayerControlPrimitives` 分派按钮、滑块、表面和菜单，歌词排版层保持 AMLL 风格中立。MIUIX 弹出偏好依赖 Activity 提供的 Navigation Event 环境，Compose、Activity、Lifecycle、Navigation Event 与 Material 3 必须作为同一兼容矩阵升级，禁止单独提升其中一个库。播放器“房间与音质”“音源账号与歌单”等复用弹层统一经风格感知的 `AppModalBottomSheet`：Material 3 使用 Material Sheet，MIUIX 使用窗口级 `WindowBottomSheet`。窗口 Sheet 内的下拉选择必须使用 `WindowDropdownPreference`，不得使用依赖主窗口 `MiuixPopupHost` 的 `OverlayDropdownPreference`；弹层存在内部详情时，返回键、手势、遮罩点击和左上角导航均先弹出内部页面，只有根页面可以关闭弹层。仪器测试应分别覆盖 MIUIX Overlay/Window 下拉弹窗和 Material 3 暴露式下拉框的实际展开路径。

| 文件 | 内容 |
| --- | --- |
| `RoomHeader.kt` | 房间标题、连接状态和横屏侧栏 |
| `RoomMembersPane.kt` | 房间成员列表 |
| `RoomQueuePane.kt` | 播放队列、固定操作栏和队列控制 |
| `RoomSearchPane.kt` | 搜索、点歌、B 站合集/分 P 选择和元数据匹配 |
| `RecommendationsPane.kt` | 已登录音乐平台的原生推荐内容和快捷点歌 |
| `MusicDownloadPane.kt` | 当前歌曲的可用下载音质与 Android 系统保存流程 |
| `RoomChatPane.kt` | 房间聊天 |
| `RoomSettingsPane.kt` | 房间设置与临时管理员队列权限 |
| `AccountSettingsPane.kt` | 身份账号和服务器管理 |
| `PlatformPane.kt` | 平台页面入口与账号列表 |
| `PlatformLoginPane.kt` | 平台登录和二维码流程 |
| `PlatformPlaylistPane.kt` | 歌单、收藏和曲目列表 |
| `AppUpdatePane.kt` | 更新检查、下载和安装 |
| `ui/player/` | 横竖屏播放器、播放控制和歌词 |

## 4. 网络与服务端协议

客户端通过 HTTP API 获取音乐、账号和管理数据，通过 `/ws` WebSocket 处理房间实时事件。

### 服务端地址

`ServerAddress.kt` 统一处理用户输入的 HTTP 或 HTTPS 地址，并派生以下端点：

- HTTP API：在基础路径后添加 `/api/*`
- WebSocket：在基础路径后添加 `/ws`
- 反向代理：保留地址中已有的基础路径

`ServerCatalog.kt` 保存多个服务端地址。大厅为每个服务端建立 discovery socket，并将房间列表合并到统一界面。

主服务端连接失败后最多自动重试 5 次，间隔依次为 2、4、8、15 和 30 秒。用户主动连接、切换服务端或连接成功时重置计数；达到阈值后停止后台重试，由用户在连接设置中手动发起新连接。

`/api/music/search` 的普通音源关键词最多为 100 个字符。B 站搜索兼容关键词、BV 号、可信 B 站视频链接和 `b23.tv` 分享链接，输入最多为 2000 个字符；短链解析与目标域名校验由服务端完成。点歌前客户端会通过 `/api/music/bilibili-collection` 读取合集或分 P，并将选中分 P 的 `cid` 保留在 `urlId`，使服务端解析并播放对应音频。B 站歌词和封面可从网易云、QQ、酷狗和酷狗概念版匹配；旧服务端缺少合集接口时按单视频流程回退。

房间状态包含临时管理员标识以及“删除单曲”“清空歌单”两个独立权限。Android 仅向房主或服务器管理员展示开关；临时管理员根据服务端下发的对应权限执行队列操作，旧服务端缺少字段时默认关闭。

`/api/music/recommendations` 按当前身份和房间返回已登录平台的原生推荐内容。请求携带 `roomId`、1 至 50 的 `limit`，并可使用 `radarPage` 与 `playlistOffset` 继续读取 QQ 雷达歌曲和推荐歌单；响应按平台提供 `tracks`、`playlists` 与独立的 `pagination` 游标。Android 按歌曲身份和 `source:id` 合并、去重分页结果；新增字段缺失时分别回退为空列表和无后续页。`unavailableReason` 区分空推荐与上游暂时不可用，旧服务端缺少接口时显示可重试错误，不影响搜索和点歌流程。

歌单详情继续按 100 首分页浏览。点击“添加全部”时，Android 从当前歌单第一页开始读取全部分页，按稳定歌曲身份去重，排除房间队列和本地待确认项，最多填充至 1000 首容量，并按每批 200 首发送 `queue:add_batch`。切换歌单或离开房间会取消未完成的全量读取。

`/api/music/download-options` 仅为当前房间正在播放的曲目返回可下载音质、实际码率、格式和可选文件大小；`/api/music/download` 按所选音质流式返回附件。Android 复用按服务器隔离的 OkHttp Cookie，默认保存到 `/storage/emulated/0/Download/music-together`，并允许在下载页修改为公共 `Download` 下的其他子目录。Android 10 及以上通过 MediaStore 写入，Android 8/9 首次下载时请求旧版外部存储权限；保存成功后将 MediaStore URI 和曲目元数据登记到本地音乐索引，应用启动时会迁移该应用此前保存但尚未索引的文件。文件名会清理非法字符并自动避让重名。下载通知显示字节或百分比进度及当前下载速度，完成后显示整段下载的平均速度；失败和取消也会更新通知，取消、切歌或离房会终止请求并清理未完成文件。旧服务端缺少接口时显示“不支持”，其他失败保留重试入口。

### WebSocket 协议

`MusicTogetherSocket.kt` 使用 OkHttp 原生 WebSocket。消息采用统一信封：

```json
{
  "event": "room:state",
  "data": {}
}
```

`Events.kt` 保存 Android 端事件名，`Json.kt` 将服务端 JSON 转换为 Kotlin 模型。`MusicTogetherViewModel.handleEvent()` 根据事件更新状态或调用播放器。

事件分为以下类别：

- 服务器级音频代理策略
- 房间生命周期与房间列表
- 播放控制与同步
- 队列更新
- 聊天
- 角色与投票
- 网络时间协议 (NTP) 校时
- 平台认证与歌单

### 身份与 Cookie

`PersistentCookieJar.kt` 按 `scheme://host:port` 保存网络 Cookie，避免多个服务端之间共享身份。

应用还会保存平台登录 Cookie，并在加入房间后恢复平台认证。平台 Cookie 的生命周期与用户主动登录、退出操作保持一致；自动恢复失败默认保留凭据，只有 QQ 明确返回 `reauth_required` 时才删除当前服务器下对应 Cookie 并提示重新扫码，`expired` 和 `error` 仍留待下次进入房间重试。

## 5. 播放同步

播放模块将 Android 媒体能力与房间同步逻辑分开。

### 播放组件

播放模块由以下组件组成：

| 文件 | 职责 |
| --- | --- |
| `PlaybackService.kt` | 持有 ExoPlayer 和 MediaSession |
| `NativePlayer.kt` | 连接 MediaSession、执行计划动作、发布播放器状态 |
| `ClockSync.kt` | 估算服务端时间和网络往返延迟 |
| `PlaybackDriftController.kt` | 选择变速修正或硬 Seek |
| `PlaybackRequestHeaders.kt` | 按播放域名添加必要请求头 |
| `PlaybackCommandBridge.kt` | 将系统媒体按钮转回房间操作 |

B站音频始终通过服务器代理播放，播放所需 Cookie 只保留在服务端。服务器管理员通过受保护的 HTTP API 控制酷狗是否强制代理，策略通过 `server:audio_proxy_policy` 实时下发，默认行为为强制代理。

关闭酷狗强制代理后，Android 对酷狗明文资源优先使用服务端解析出的 CDN 地址，并保留服务器代理地址作为一次性回退。直连加载失败时 `NativePlayer` 保持当前进度切换到代理；重新开启强制代理时，正在直连的酷狗曲目也会切回代理。该策略同时覆盖标准版和概念版；服务端通过可选的 `Track.requiresServerProxy` 标记需要 QMC2 解密的资源，Android 对这些资源直接使用服务器代理。其他来源继续使用服务端下发的直连地址。

### 同步流程

客户端先校准服务端时间，再执行和修正播放进度：

1. 客户端通过 NTP ping/pong 采集服务端时间偏移和往返延迟
2. 服务端在播放状态中附带 `serverTimestamp`
3. 离散操作可以附带 `serverTimeToExecute`
4. `NativePlayer` 在目标服务端时间执行播放、暂停或 Seek
5. 周期同步比较本地进度与服务端期望进度
6. 开启自动变速时，小漂移通过保持音高的限幅变速修正
7. 持续的大漂移可以独立启用淡出、Seek 和淡入修正

自动变速和大偏差硬 Seek 默认关闭并分别持久化；升级到该设置架构时会执行一次迁移，之后保留用户选择。

MediaSession 接收系统播放按钮。相关操作通过 `PlaybackCommandBridge` 返回 ViewModel，再根据房间角色直接发送控制事件或发起投票。

## 6. 歌词系统

歌词模块负责来源解析、时间整形、播放时间轴和 Compose 绘制。

### 歌词数据流

歌词数据从接口响应流向解析器、时间轴和 Compose 组件：

```text
MusicTogetherApi
  -> LyricsParser
    -> LyricsState
      -> AmllLyricsEngine
        -> AmllPlaybackTimeline
          -> AmllLyrics / AmllKaraokeText
```

### 解析层

`LyricsParser.kt` 支持：

- TTML 逐词歌词
- 服务端逐词 JSON
- 网易云 YRC
- LRC 行级歌词
- 翻译和音译合并
- Ruby、背景人声和对唱标记

### AMLL 数据层

AMLL 纯算法按职责分布：

- `AmllLyricsEngine.kt` 清理和校正歌词时间，并组合主歌词与背景人声
- `AmllInterludeEngine.kt` 识别间奏和计算行切换弹簧参数
- `AmllWordLayout.kt` 按字素和词块组织歌词并计算平衡换行
- `AmllLyricEffects.kt` 计算遮罩、强调曲线和逐词进度
- `AmllLyricsModels.kt` 保存以上算法共享的不可变数据结构

`AmllPlaybackTimeline.kt` 使用共享单调时钟推进热行、缓冲行和间奏。Seek 会更新代际并重新校准焦点。普通 LRC 保留原始行时间戳作为高亮边界，在正常播放且行间距允许时将滚动焦点提前 300ms 预定位；暂停、Seek 和快速连续行严格按原时间逐行对齐。逐字歌词继续使用 AMLL 的提前时间优化。

### Compose 绘制层

`AmllLyrics.kt` 负责歌词视口组合，列表模型与锚点计算位于 `AmllLyricsLayout.kt`，手动浏览选择推导位于 `AmllLyricsBrowse.kt`，行级跟随参数位于 `AmllLineMotion.kt`；行绘制、时间预览和间奏分别位于 `AmllLyricLine.kt`、`AmllLyricPreview.kt` 和 `AmllInterlude.kt`。歌词页首次组合时直接从当前焦点行开始列表测量，再做一次无动画锚点校正，避免从第一行组合后又跳转到播放位置。目标行高度实际变化时才重新校准锚点，不使用固定帧数的重复修正。手动浏览沿用当前横竖屏焦点锚点，不建立独立选线基准；左对齐歌词的时间标签固定在歌词区右侧，对唱右对齐歌词固定在左侧，并依据主歌词换行后的实际可视行边界判断碰撞，固定侧空间不足时直接隐藏而不跳到另一侧。选中框由覆盖层绘制，只使用与当前选中行索引匹配的最新几何快照，不参与歌词测量、换行或列表间距。

`AmllKaraokeText.kt` 负责逐词行入口；平衡布局、词层与字素动画分别位于 `AmllKaraokeLayout.kt`、`AmllKaraokeWord.kt` 和 `AmllKaraokeGlyph.kt`。这些文件共享同一播放时间轴，不得各自创建独立时钟。

等待点与 AMLL 一致，由独立覆盖层按下一句边界定位并使用单个 Canvas 绘制；上一句仅在等待期间保留圆点高度与行间距，不改变歌词索引且避免覆盖相邻歌词。Seek 进入间奏中段时从 Seek 时刻重新播放入场。暂停播放时共享歌词时钟停止逐帧更新；正常模式将时间轴限制到最高约 60 帧，省电模式或系统关闭动画时限制到约 30 帧并关闭强调光晕。动态歌词只在激活与退场阶段保留渐变离屏层，稳定未激活后切回纯色渲染。播放器显示设置可独立控制翻译、音译、字号、字重、竖屏焦点位置、弹簧、缩放、非当前行模糊和动态背景强度；非当前行模糊默认关闭，避免无意增加 GPU 压力。含对唱行的曲目按 AMLL 为普通行右侧、对唱行左侧保留 15% 布局安全区。

竖屏歌词视口使用顶部锚点和 10% 垂直位置，横屏使用中心锚点和 35% 垂直位置，避免网页端 40% 中心锚点在移动端受顶部歌曲栏和底部控制栏压缩后令激活行过度下沉；边缘遮罩范围为 10% 至 91%。相邻歌词行保持 0.4em 间距，主歌词与背景人声间距为 0.3em。只有 TTML、YRC 和逐词来源进入 AMLL 逐字遮罩时间轴，普通 LRC 使用整行明暗切换且不再叠加歌词组级暗化。激活遮罩使用 300ms 进入和 450ms 退场且只应用一次，背景人声的透明度、位移和内部缩放分别使用 AMLL 对应的过渡与弹簧参数。手动浏览或暂停时进入低开销阅读状态，适度提亮主歌词、翻译和罗马音，恢复未激活行缩放并展开背景人声；Seek 会重建可见行动画状态，暂停、恢复或等待态改变实际行高后按布局事件校准焦点，不运行固定帧数的追踪任务。

竖屏播放器由 `PortraitPlayer.kt` 编排宽度和模式切换，`PortraitPlayerHeroes.kt` 管理封面与歌词视觉区，`PortraitPlayerControls.kt` 管理歌曲信息、进度和播放控制。横屏播放器继续由 `LandscapePlayer.kt` 编排，双方复用 `PlayerArtwork`、`PlayerBackdrop`、`PlayerChrome` 和 `PlayerProgressSlider`。

完整播放器与主页迷你播放器由 `PlayerMinimizeTransition.kt` 执行双向容器变换，不加入播放器内部封面与歌词使用的共享元素作用域。收起时完整播放器轻微缩小并淡出、主页短距离上浮进入，迷你播放器的材质背景、封面、歌曲信息和控制按钮按顺序出现；展开时反向执行。过渡期间两侧短暂共存并暂停背景持续漂移，避免额外动画负载干扰播放器内部布局。房间内的系统返回键和返回手势会先关闭当前弹层或菜单，随后收起为迷你播放器；只有右上角菜单中的“离开房间”会真正退出房间。

竖屏播放器使用顶部焦点锚点，横屏播放器使用中心焦点锚点；竖屏尺寸与区块间距继续按 Android 可用空间自适应，歌词模式以 300ms 淡入和 20dp 上移动画进入。歌词偏移按曲目和歌词来源保存，B 站曲目还包含元数据来源。

播放器背景复用 Coil 缓存并单独解码低分辨率软件位图，通过 AndroidX Palette 提取少量主色。封面、背景和曲目信息在切歌时交叉过渡；打开房间弹层、处于低内存或省电模式、或系统关闭动画时停止持续背景运动。

## 7. 本地数据与 Android 集成

应用使用 SharedPreferences 保存以下数据：

- 服务端列表和当前服务端
- 昵称与身份相关设置
- 房间重进令牌
- 平台登录 Cookie
- 网络 Cookie
- 歌词偏移
- 播放同步间隔、自动变速和大偏差硬 Seek 设置
- 界面风格、主题、动态色、应用模糊、底栏样式与玻璃效果
- 歌词显示、动画和播放器动态背景设置
- 更新下载源
- 音乐默认下载目录

`ChatNotificationManager.kt` 负责后台聊天通知。`AppLogger.kt` 只在 Debug 构建中写入和导出日志。

`AndroidManifest.xml` 声明网络、媒体前台服务、通知、应用内安装权限，以及仅限 Android 8/9 的公共下载目录写入权限。`PlaybackService` 作为 MediaSessionService 提供系统媒体通知和锁屏控制。

## 8. 构建与发布

工程包含两个 distribution flavor：

构建产物包括 Android Package (APK) 和 Android App Bundle (AAB)。

| Flavor | applicationId | 产物 |
| --- | --- | --- |
| `standard` | `io.github.yueby.musictogether` | Standard APK、AAB |
| `vivo` | `cmccwm.mobilemusic` | vivo/iQOO APK |

`.github/workflows/android.yml` 在 Android 文件变化时运行：

- Standard Debug 单元测试
- Standard Debug Lint
- Standard Debug APK 构建
- Vivo Debug APK 构建
- SHA-256 生成和 Debug 产物上传

推送中 `versionName` 发生变化时，CI 会触发签名 Release 构建，与提交类型无关。发布任务生成 Standard/Vivo APK、Standard AAB 和 SHA-256，并创建或更新对应的 GitHub Release。若存在版本专用说明 `docs/releases/<version>.md`，Release 正文直接采用该文件；否则以最近的上一版本标签为基线，逐条列出到当前构建提交之间所有非合并提交的标题与短 SHA，并附带 GitHub 比较链接。同版本重新发布时也会同步刷新正文。

本地构建与验证命令见根目录 [AGENTS.md](../AGENTS.md)。
