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
| 多音源 | 网易云音乐、QQ 音乐、酷狗音乐和 B 站 |
| 平台账号 | 扫码或 Cookie 登录、歌单、收藏夹和音质权限 |
| 歌词 | TTML、YRC、LRC、逐词歌词、翻译、音译、Ruby 和本地偏移 |
| Android 集成 | ExoPlayer、MediaSession、媒体通知和应用内更新 |

### 技术栈

当前工程配置如下：

| 项目 | 当前配置 |
| --- | --- |
| 语言 | Kotlin 2.2.20，Java Virtual Machine (JVM) 17 |
| 构建 | Gradle Wrapper，Android Gradle Plugin 8.11.1 |
| Android | `minSdk 26`，`targetSdk 36`，`compileSdk 36` |
| 用户界面 | Jetpack Compose，Material 3 |
| 网络 | OkHttp 4.12，HTTP API，原生 WebSocket |
| 播放 | Media3 ExoPlayer，MediaSessionService |
| 图片 | Coil 3 |
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
├── MainActivity.kt
├── MusicTogetherViewModel.kt
├── logging/
├── lyrics/
├── model/
├── network/
├── notifications/
├── player/
└── ui/
    └── player/
```

| 路径 | 内容 |
| --- | --- |
| `MainActivity.kt` | 应用入口、主题和 Compose 挂载 |
| `MusicTogetherViewModel.kt` | 应用状态与业务模块编排 |
| `model/` | 房间、曲目、歌词、账号和界面状态 |
| `network/` | 服务端连接、协议转换和应用更新 |
| `player/` | 后台播放、系统媒体控制和同步 |
| `lyrics/` | 歌词解析和 Apple Music-like Lyrics (AMLL) 数据处理 |
| `ui/` | 大厅、房间、设置、账号和平台界面 |
| `ui/player/` | 播放器布局与歌词绘制 |
| `notifications/` | 聊天通知 |
| `logging/` | Debug 日志记录与导出 |

## 3. 架构与数据流

应用采用单 Activity、Compose 界面、ViewModel 编排和 MediaSession 后台播放的结构。

```text
MainActivity
  -> MusicTogetherApp
    -> LobbyScreen / RoomScreen
      -> RoomHeader / RoomPanels / Settings / Player

UI 操作
  -> MusicTogetherViewModel
    -> MusicTogetherApi / MusicTogetherSocket / SharedPreferences
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

`MusicTogetherViewModel` 持有 `StateFlow<AppState>`。`AppState` 包含服务器、房间、账号、搜索、歌词、平台中心、同步设置和应用更新状态。

播放器通过独立的 `StateFlow<PlayerUiState>` 发布当前曲目、播放状态、进度、时长、缓冲和错误。Compose 页面同时收集两个状态流。

### 界面入口

`MusicTogetherApp.kt` 根据房间状态显示 `LobbyScreen` 或 `RoomScreen`。`RoomScreen.kt` 负责房间整体布局和面板切换，具体内容分布在以下文件：

| 文件 | 内容 |
| --- | --- |
| `RoomHeader.kt` | 房间标题、连接状态和横屏侧栏 |
| `RoomPanels.kt` | 成员、队列、搜索、聊天和投票 |
| `RoomSettingsPane.kt` | 房间设置 |
| `AccountSettingsPane.kt` | 身份账号和服务器管理 |
| `PlatformPane.kt` | 平台登录、歌单和收藏 |
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

- 房间生命周期与房间列表
- 播放控制与同步
- 队列更新
- 聊天
- 角色与投票
- 网络时间协议 (NTP) 校时
- 平台认证与歌单

### 身份与 Cookie

`PersistentCookieJar.kt` 按 `scheme://host:port` 保存网络 Cookie，避免多个服务端之间共享身份。

应用还会保存平台登录 Cookie，并在加入房间后恢复平台认证。平台 Cookie 的生命周期与用户主动登录、退出操作保持一致。

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

### 同步流程

客户端先校准服务端时间，再执行和修正播放进度：

1. 客户端通过 NTP ping/pong 采集服务端时间偏移和往返延迟
2. 服务端在播放状态中附带 `serverTimestamp`
3. 离散操作可以附带 `serverTimeToExecute`
4. `NativePlayer` 在目标服务端时间执行播放、暂停或 Seek
5. 周期同步比较本地进度与服务端期望进度
6. 小漂移通过保持音高的变速修正
7. 持续的大漂移通过淡出、Seek 和淡入修正

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

`AmllLyricsEngine.kt` 负责：

- 清理和校正歌词时间
- 组合主歌词与背景人声
- 识别间奏
- 按字素和词块组织歌词
- 计算平衡换行
- 计算遮罩、强调曲线和弹簧参数

`AmllPlaybackTimeline.kt` 使用共享单调时钟推进热行、缓冲行和间奏。Seek 会更新代际并重新校准焦点。

### Compose 绘制层

`AmllLyrics.kt` 负责列表布局、焦点滚动、距离模糊、间奏点和时间预览。`AmllKaraokeText.kt` 负责逐词遮罩、长音强调、Ruby 和字素动画。

竖屏播放器使用顶部焦点锚点，横屏播放器使用中心锚点。歌词偏移按曲目和歌词来源保存，B 站曲目还包含元数据来源。

## 7. 本地数据与 Android 集成

应用使用 SharedPreferences 保存以下数据：

- 服务端列表和当前服务端
- 昵称与身份相关设置
- 房间重进令牌
- 平台登录 Cookie
- 网络 Cookie
- 歌词偏移
- 播放同步设置
- 更新下载源

`ChatNotificationManager.kt` 负责后台聊天通知。`AppLogger.kt` 只在 Debug 构建中写入和导出日志。

`AndroidManifest.xml` 声明网络、媒体前台服务、通知和应用内安装权限。`PlaybackService` 作为 MediaSessionService 提供系统媒体通知和锁屏控制。

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

推送中 `versionName` 发生变化时，CI 会触发签名 Release 构建，与提交类型无关。发布任务生成 Standard/Vivo APK、Standard AAB 和 SHA-256，并创建或更新对应的 GitHub Release。

本地构建与验证命令见根目录 [AGENTS.md](../AGENTS.md)。
