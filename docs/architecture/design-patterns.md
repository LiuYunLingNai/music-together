# 设计模式

## 前端模式

## Zustand Store 模式

5 个独立 store，各自管理一个领域的状态：

| Store           | 职责                                                | 持久化                    |
| --------------- | --------------------------------------------------- | ------------------------- |
| `playerStore`   | 播放状态（曲目、进度、音量、歌词）                  | 音量持久化到 localStorage |
| `roomStore`     | 房间状态（room、currentUser 自动推导自 room.users） | 无                        |
| `chatStore`     | 聊天（消息列表、未读数、开关状态）                  | 无                        |
| `lobbyStore`    | 大厅（房间列表、加载状态）                          | 无                        |
| `settingsStore` | 设置（歌词对齐/动画/字体/翻译字体大小、背景参数）   | 全部持久化到 localStorage |

使用方式：通过选择器订阅特定字段，避免不必要的渲染：

```typescript
const volume = usePlayerStore((s) => s.volume)
```

在 Socket 回调中使用 `getState()` 避免闭包问题：

```typescript
const room = useRoomStore.getState().room
```

## 自定义 Hooks 组合模式

两个核心组合 hook 各自编排多个子 hook：

```
usePlayer                             useRoom
├── useHowl (Howler.js 实例)          ├── useRoomState (核心房间事件)
├── useLyric (歌词解析)                ├── useChatSync (聊天事件)
└── usePlayerSync                     ├── useQueueSync (队列事件)
    ├── Scheduled Execution           ├── useAuthSync (Cookie 持久化 + toast 反馈，永不删除 cookie)
    └── Host Progress Reporting       └── useConnectionGuard (断线重置)

SocketProvider (连接管理，无 NTP)

RoomPage
└── ClockSyncRunner → useClockSync (NTP 时钟同步，仅房间内运行)
```

通用工具 Hook：`useSocketEvent(event, handler)` 封装 `socket.on/off` 样板代码，已在 `useLobby` 和 `useVote` 中使用。

其他独立 hook：`useChat`、`useLobby`、`useQueue`、`useVote`、`useAuth`、`usePlaylist`，每个 hook 负责将 Socket 事件绑定到对应 Store。

`usePlaylist` 管理歌单功能：通过 Socket 获取用户歌单列表（`playlist:get_my` → `playlist:my_list`），通过 REST 分页获取歌单曲目（`GET /api/music/playlist?limit=100&offset=0`，返回 `{ tracks, total, offset, hasMore }`），提供 `loadMoreTracks()` 无限加载下一页、URL/ID 解析工具函数（`parsePlaylistInput`），以及单曲/批量添加到队列。切换歌单时立即重置状态防止闪旧数据，内部 `loadingMoreRef`（ref）做同步防重，避免 React 批量更新前的闭包竞态。URL 拼接通过 `buildPlaylistUrl()` 辅助函数集中管理。

## 受控 Dialog 模式

所有弹窗组件遵循统一的 prop 接口：

```typescript
interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // 业务回调...
}
```

父组件（页面）管理 `open` 状态，弹窗组件只负责渲染和用户交互。

## ResponsiveDialog 模式

`responsive-dialog.tsx` 通用组件根据视口宽度自动切换呈现方式：

- **桌面端**（≥640px）：居中 Dialog（基于 Radix UI）
- **移动端**（<640px）：底部 Drawer（基于 vaul，支持拖拽关闭）

通过 React Context 向子组件传递 `isMobile` 状态，提供一一映射的子组件：`ResponsiveDialog`、`ResponsiveDialogContent`、`ResponsiveDialogHeader`、`ResponsiveDialogTitle`、`ResponsiveDialogDescription`、`ResponsiveDialogFooter`、`ResponsiveDialogClose`、`ResponsiveDialogBody`。使用方只需替换 import 路径即可获得响应式行为。项目中所有业务弹窗（CreateRoomDialog、PasswordDialog、NicknameDialog、SearchDialog、SettingsDialog）均已迁移至此组件。

## Context Provider 模式

`SocketProvider` 通过 React Context 提供原生 WebSocket 类型化客户端和连接状态，并内置断线/重连 Toast 提示：

```typescript
const { socket, isConnected } = useSocketContext()
```

`AbilityProvider` 通过 React Context 提供 CASL ability 实例，组件可通过 `useContext(AbilityContext)` 查询权限。

## 组件组合模式

`AudioPlayer` 是一个薄壳，只负责选择舞台、渲染模式菜单，并把既有播放回调透传给选中的舞台。经典舞台 `classic/ClassicPlayerStage` 组合 `NowPlaying` + `SongInfoBar` + `PlayerControls` + `LyricDisplay`；Mineradio 舞台 `mineradio/MineradioPlayerStage` 组合粒子场景 + 空间化歌词 + 底部玻璃控制台。`RoomPage` 组合所有功能区域和覆盖层弹窗。

### 播放器舞台切换（Mineradio）

播放器有两种并列体系，由 `settingsStore.visualStage` 决定，默认 `classic`：

| 舞台 | 组件 | 说明 |
| ---- | ---- | ---- |
| 经典播放器 | `classic/ClassicPlayerStage` | 改造前的完整原布局，行为不变，始终可无损回退 |
| 视觉模式 | `mineradio/MineradioPlayerStage` | Emily / 滚筒 / 星球 / 唱片 / 星河 / 声波地形 |

关键约束：

- **舞台切换只影响渲染子树。** 播放、暂停、切歌、跳转、权限、投票、房间同步和漂移校正全部位于 `usePlayer` / `useHowl` / `usePlayerSync`，舞台组件不参与，因此切换不会中断歌曲、重置进度或影响房间权威状态。
- **按需加载。** `MineradioPlayerStage` 通过 `React.lazy` + 动态 `import()` 加载，`three` / `@react-three/fiber` 因此被打进异步 chunk。**不要在 `vite.config.ts` 的 `manualChunks` 里为 three 命名独立 chunk** —— 那会让 Rollup 把 three 提升为同步依赖，导致 `index.html` 直接 `modulepreload` 约 900 KB 的 three，经典播放器也要白白下载。
- **单一 Canvas。** 同一时刻只存在一个 three Canvas；切回经典播放器即卸载场景并释放几何、材质与纹理。
- **音频通过 SoundTouch 输出上的只读 tap 取样（masterGain 仅兜底）。** 见下节。

### 视觉舞台的构图（参照 Mineradio / OpenMusic）

舞台是**全屏 3D 场景 + 透明前景层**，而不是"窄列里放一块背景"：

```
舞台根（absolute inset-0）
├── 环境底色层      AmbientBackdrop：封面模糊铺底 + 主色渐变（z-0，在画布之下）
├── 画布层          封面采样粒子 + 3D 队列架 + 世界空间歌词网格（透明清屏）
├── 暗角层          pointer-events: none
└── 控制栏          底部居中浮动胶囊，pointer-events: auto
```

**环境底色层是必需的，不是可选装饰。** 画布以 `alpha: true` + 透明清屏渲染，
因此色彩来自它下方的 DOM 层。若缺少这一层，整个舞台会退化成一块近黑矩形 ——
这正是"背景全黑"问题的成因。上游同样有这一层：

- Mineradio `#album-bg`：`filter: blur(120px) brightness(0.18) saturate(1.5)`，`transform: scale(1.4)`
- OpenMusic `RoomAmbientBackground`：颜色 / 图片 / 视频环境层

| 维度 | 取值 | 来源 |
| ---- | ---- | ---- |
| 画布 | 全屏铺满且**透明** | Mineradio `#canvas-container { fixed; inset: 0 }` |
| 点精灵 | 64×64 径向渐变纹理（0.96/0.78/0.22/0） | Mineradio `makeDotTexture` |
| 泛光 | 同 geometry 第二遍，`uBloomStrength 0.62` / `uBloomSize 2.65`，`renderOrder 0/1` | Mineradio `00-pointer-cover-particles.js` |
| 涟漪 | 最多 10 组，`RIPPLE_COOLDOWN 0.32s`，寿命 1.6s，低频命中触发 | Mineradio `15-ripples-cover-depth.js` |
| 歌词网格 | `worldW = 6.10`，`LYRIC_PLANE_Z = 1.46`，`scale 0.96` | Mineradio `13-lyrics-mesh-build.js` |
| 栅格化字号 | `128px`（栅格化分辨率，非屏幕像素） | 同上 |
| 歌词块占视口 | 高度 ≤52%、宽度 ≤90%（相机锁定时 ≤44% / ≤84%） | OpenMusic `fitLyricStack` |
| 星河流 | 独立 Points，`1400` 点，`position(0, 0.20, 1.53)`，`renderOrder 45` | Mineradio `03-lyrics-star-river.js` |
| 控制栏 | `min(720px, 100vw - 3rem)` 居中胶囊 | Mineradio 1120px / OpenMusic 720px |

**音频驱动**（`shared/SonicAudioMonitor.ts` + `shared/AudioAnalyser.ts`）：
从 SoundTouch 输出的只读 tap 取样（masterGain 仅兜底，见下节），
按上游八频段 Hz 边界（`SONIC_BAND_EDGES`，32/58/…/16000）做加权 RMS 分频，
经六节拍窗口 flux 打分 + 90 帧自适应 std-dev 阈值 + drumGate 得到 kick 包络与节拍信号，
由 `ParticleScene` 的 `AudioStepDriver` 每帧**单点驱动**一次，消费者读缓存。

### 封面可辨识度的决定因素：点尺寸，而非粒子数

**这是本项目最容易搞错的一点，务必留意。**

| | 上游 | 说明 |
| --- | --- | --- |
| 网格 | `grid = round(118 * coverResolutionScale)`，夹在 88..183，取**奇数** | 89²=7,921 / 119²=14,161 / 149²=22,201 |
| 点尺寸 | `clamp(depthSize * audioBoost, **1.05, 4.95**)`，`depthSize = 36 / -mv.z` | 1-5px 的极小点 |
| `uPointScale` | `1.0` | — |

14,161 个粒子铺在 1440×900 上，**每格约 9.6px**。点尺寸必须接近格子大小（约为格子的 0.5 倍），
图像才能被"拼"出来。

⚠️ **早期实现把上限写成 42px（4.4 倍格子），结果所有细节糊成色块 —— 这就是"看不到可辨识封面"的根因。**
注意：修复只需改点尺寸，**粒子数本来就已落在上游区间内**。

### 各模式的视觉身份

5 个粒子模式共用一套几何与着色器程序（3 号 VOID 槽位按上游留空），但**不只是重映射位置**：
公共阶段还按 `uPreset` 给出**独立的亮度曲线与点尺寸曲线**
（如唱片用环形驱动 `sz = clamp(depthSize*(0.90+ringDrive*0.62), 1.05, 3.90)`、
星河用流动驱动），否则切换模式会读起来只是"同一团粒子换形状/缩放"。

预设槽位分配（注意 3 号的特殊处理）：

| 槽位 | 模式 |
| --- | --- |
| 0 | Emily 专辑封面 |
| 1 | 滚筒 |
| 2 | 星球 |
| **3** | 「虚空」—— 上游刻意空实现，本项目同样不提供模式（曾自创的「封面视界」已按用户决策删除，旧持久化值安全回退 classic） |
| 4 | 唱片 |
| 5 | 星河 |

「声波地形」（上游 sonic-topography，INDEX=7）是**独立模块**（`topography/`），不占 uPreset 槽位，与粒子层互斥挂载。

### 底部控制栏：必须自建，不能复用经典播放器组件

上游 `#controls` 是三列 grid：

```css
grid-template-columns: minmax(0,1fr) max-content minmax(0,1fr);
/* .control-cluster.actions → grid-column 1（封面 52px + 标题） */
/* .control-cluster.transport → grid-column 2（播放控制）        */
/* .control-cluster.modes → grid-column 3（音量/队列）           */
```

**不能用 `SongInfoBar` / `PlayerControls`**：它们内置 `zoom = clientWidth / 300` 的缩放，
布局假设是经典播放器的**左右分栏窄列**，塞进横向胶囊必然比例失调 ——
这正是"控制栏不和谐"的根因。因此 Mineradio 舞台使用自建的
`mineradio/MineradioTransport.tsx`，但**播放、权限、投票仍沿用同一套 store 与 Ability**，
语义与经典播放器一致。

WebGL 歌词点击只绑定在画布层；控制栏、投票条和 AMLL 回退层与画布是兄弟节点，
控制操作不会冒泡为歌词跳转。10Hz 播放时间也只由 memo 化的进度条子组件订阅，
避免让整组按钮、Tooltip 与 Popover 跟随时钟重渲染。

**统一轨道相机**（`particles/CameraRig.tsx`）：按 OpenMusic 的预设半径、俯仰角和方位角控制构图，并在同一帧循环内组合闲置电影运镜与 `theta/phi/radius/roll` 节拍冲击。拖拽旋转、滚轮缩放和双击回正复用同一份 `orbitCameraState`，避免两个 `useFrame` 回调竞争写入相机。

**3D 队列架**（`particles/FloatingSongShelf.tsx`）：最多读取 24 首 `currentTrack + room.queue`，用 720×360 Canvas 纹理绘制封面、曲名、歌手、进度和状态。滚轮切换居中卡片，悬停时放大并触发相机跟拍，点击复用现有 `onOpenQueue`。队列架只读房间权威状态，不增加队列写操作或 WebSocket 事件。低、中、高画质分别保留 6、12、24 张卡片；减少动态效果时关闭呼吸与电影运镜。

**歌词特效**（`lyrics/lyricShaders.ts`）：glitch（横向切条位移 + RGB 色散）、
sweep（扫光）、shimmer（微光细线）、solar（节拍泛光），强度由运动风格驱动
（`lyrics/lyricDisplayConfig.ts` 的 6 种 `motionProfile`）。
显示模式 6→5 种（single/dual/triple/cinema/custom 1-10 行）、译词模式 4 种。

**配色**：`lyrics/coverPalette.ts` 从封面提取 5 个语义色
（primary / secondary / highlight / shadow / glow），驱动歌词与粒子着色器；
取不到时回退默认冷色调。

**歌词尺寸必须做视口适配。** 网格高度不能直接取"世界宽度 × 画布宽高比"——
画布宽度由文字长度决定，那样会让短句被放到溢出屏幕、长句缩到看不清
（实测短句平面高 8.95 超过可见高度 5.58）。
`lyrics/lyricFit.ts` 的 `fitLyricBlock` 负责按视口预算求整体缩放，
保证任意句长的构图都稳定。

### WebGL 歌词层

歌词**不再使用 DOM**，而是作为世界空间网格参与 3D 场景（`mineradio/lyrics/`）：

| 文件 | 职责 |
| ---- | ---- |
| `stageLyricModel.ts` | 纯计算：字符区间、背景行折叠、逐字进度、激活行判定 |
| `rasterizeLyricMask.ts` | 把若干行栅格化为一张遮罩画布（R=激活行，A=形状） |
| `lyricShaders.ts` | 逐字填充着色器 |
| `LyricStage.tsx` | 构建网格、每帧推进进度、上报行命中区域 |

**逐字实现**：AMLL 的 `LyricWord` 只有 `startTime/endTime`，没有字符偏移。
`stageLyricModel` 按顺序累加每个字的长度得到等价于 Mineradio 的 `c0/c1` 区间，
着色器据此在 UV.x 上插值——因此高亮边界落在字与字之间，是真正的逐字而非整行擦除。

**本项目特性在 WebGL 中的表达**（上游没有这些，属自研）：

- **对唱 `isDuet`**：整体右对齐（插值 `centerX`），与 AMLL 的 `hasDuetLine` 语义一致
- **背景歌词 `isBG`**：按 AMLL 规则折叠连续背景行（只保留第一个），
  挂到前一个主行上，主行激活时作为次行显示
- **译词 / 音译**：作为附属小字跟在主行下方，行距相应放大
- **敏感词遮罩**：依据逐字 `obscene` 标记替换，保持字符数不变以免逐字区间错位
- **校准偏移**：在计算 `now` 时统一扣除 `lyricOffsets`，与 AMLL 路径同口径
- **点击跳转**：`LyricStage` 上报各行的归一化命中区域，点击时反查行索引并复用 `onLyricSeek`

**回退**：`settingsStore.lyricRenderer` 可在 `webgl`（默认）与 `amll` 之间切换。
选择 `amll` 时不再渲染 WebGL 歌词，改由 `MineradioLyricStage` 的 DOM 层接管，
因此逐字表现始终有一个可信的参照实现。

**歌词数据链路不变**：`useLyric` / `lyricTimeline` 一行未改，
WebGL 只是 `LyricLine[]` 的另一个消费者，多源择优与回退链完全不受影响。

### 视觉舞台的音频接入

`mineradio/shared/AudioAnalyser.ts` 按优先级使用两个只读 `AnalyserNode`：

```
首选：HTMLMediaElement → createMediaElementSource → SoundTouch(worklet) ─┬→ ctx.destination
                                                                        └→ AnalyserNode（tap，lib/audioTap.ts 发布）
兜底：SoundTouch 图尚未建立时，临时挂 Howler.masterGain（该线可能无音频流过）；
      tap 发布后逐帧自动升级到 tap。
```

**绝不能调用 `context.createMediaElementSource(audio)`。** Howler 的 HTML5 媒体元素已经被 `lib/timeStretch.ts` 接入了 SoundTouch 音频图，同一个 `HTMLMediaElement` 只能创建一次 `MediaElementAudioSourceNode`，重复调用会抛错并导致无声。接入失败时只降级为「没有实时频谱」，不影响播放。

### 视觉舞台的子目录边界

```
components/Player/
├── AudioPlayer.tsx          # 薄壳：选舞台 + 模式菜单 + 回调透传
├── classic/                 # 经典播放器（原布局原样抽出）
└── mineradio/
    ├── MineradioPlayerStage / VisualModeMenu / MineradioControlBar / MineradioLyricStage
    ├── particles/           # 粒子、星河、统一轨道相机、3D 队列架及着色器
    └── shared/              # VisualMode / RenderPolicy / AudioAnalyser / 封面纹理
```

6 个视觉模式共用**同一个**顶点着色器程序，按 `uPreset` 分支，因此切换模式只改 uniform，不重建几何、不重新编译 shader。新增模式只需在 `shared/VisualMode.ts` 登记并添加一个着色器分支。

## 移动端双模式播放页面

移动端（竖屏）播放页面通过 `lyricExpanded` 状态实现两种模式切换，模仿 Apple Music 移动端交互：

- **默认模式**（`lyricExpanded=false`）：大封面 + 歌曲信息 + 控制器，封面自适应剩余空间（`flex-1 min-h-0` + `aspect-square max-h-full max-w-full`），控制器固定底部，不显示歌词
- **歌词模式**（`lyricExpanded=true`）：点击封面后，封面缩小到顶部变为 compact 横排（48px 小封面 `rounded-md` + 标题 `text-base` / 艺术家 `text-sm`），歌词区域 fade+slide-up 入场占满中间空间，控制器固定底部

布局策略：

- 移动端外层 padding `px-5 py-7`（水平 20px，垂直 28px），所有子元素 `w-full`，不使用 `max-w` 约束，边距由外层 padding 统一控制
- `NowPlaying` wrapper 使用 `flex-1 min-h-0`，默认模式下封面在剩余空间内居中缩放（`aspect-square max-h-full max-w-full`），避免封面过大挤压控件

关键技术：

- `NowPlaying` 组件支持 `compact` prop 切换大图/小图布局，`onCoverClick` 触发模式切换
- `framer-motion` 的 `layoutId`（"cover-art" / "song-info"）实现封面和文字在两种布局间的共享布局动画（0.45s Apple 风格贝塞尔缓动）
- `LayoutGroup` 包裹移动端内容区，确保跨组件 `layoutId` 动画生效
- `AnimatePresence` + `motion.div` 实现歌词区域的 fade+slide-up 入场/退场
- 歌词模式状态在切歌时保持不变，用户手动点击封面切换
- 桌面端保持左右分栏布局不受影响

## 后端模式

## 分层架构

```
Controller → Service → Repository / Utils
```

- **Controller**：注册 Socket 事件监听器，薄编排层（校验输入 → 调用 Service → 编排通知）。不包含业务逻辑。
- **Service**：业务逻辑、跨领域编排、Socket 广播。关键服务职责拆分：
  - `roomService`：房间 CRUD + 角色管理 + 临时管理员协调（`reconcileRoomRoles`）+ conductor 选举（`electConductor`）+ 加入校验（`validateJoinRequest`）。Re-export `toPublicRoomState` 和 `broadcastRoomList` 以保持控制器调用方式不变。
  - `roomLifecycleService`：房间空置删除定时器 + 防抖广播。不依赖 `roomService`，消除循环依赖。API：`scheduleDeletion`、`cancelDeletionTimer`、`broadcastRoomList`、`clearAllTimers`。角色宽限期已移除（conductor 自动选举，无需 grace period）。
  - `playerService`：播放状态管理 + 流 URL 解析 + 切歌防抖 + 加入播放同步（`syncPlaybackToSocket`）+ 房间清理（`cleanupRoom`）。`playTrackInRoom` 通过 per-room Promise 链互斥锁防止并发竞态。`playNextTrackInRoom` / `playPrevTrackInRoom` 将 debounce + 队列导航 + 播放统一封装在 mutex 内部。`autoPlayIfEmpty` 在 mutex 内重新检查 `room.currentTrack`，防止并发 QUEUE_ADD 双重自动播放。
- **Repository**：运行时房间状态使用内存 Map；账号、永久房间、离线成员、平台凭据和服务器设置按职责持久化到 SQLite
- **Utils**：纯函数工具（`toPublicRoomState` 等），无状态，可被任意层引用

## Repository 模式

使用 TypeScript 接口抽象数据访问：

```typescript
interface RoomRepository {
  get(roomId: string): RoomData | undefined
  set(roomId: string, room: RoomData): void
  delete(roomId: string): void
  getAll(): Map<string, RoomData>
  // ...
}
```

`roomRepository` 以 `Map<string, RoomData>` 维护活跃房间，并通过永久房间仓库把需要跨重启保留的快照写入 SQLite；不要把短期 `streamUrl` 直接持久化。

## WebSocket 中间件链

```
withPermission(action, subject)  →  withRoom(io)  →  Handler
withOwnerOnly(io)                →  withRoom(io)  →  Handler
```

- `withRoom`：校验 Socket 是否在房间中，构建 `HandlerContext`（io, socket, roomId, room, user）
- `withPermission`：在 `withRoom` 基础上用 CASL `defineAbilityFor(role)` 检查 `(action, subject)` 权限
- `withOwnerOnly`：在 `withRoom` 基础上仅允许房主（`user.role === 'owner'`），用于设置和角色管理
- `socketRateLimiter`：按持久化用户身份限制关键控制事件，并为 QR/Cookie 认证使用独立额度；匿名连接才在断开时立即删除条目，身份级条目由 TTL 清理，避免多标签页绕过或互相重置限流
- `httpRateLimiter`：按身份 Cookie（无身份时按 IP）限制音乐元数据请求；封面代理不设请求次数限额，但仍保留受信主机、HTTPS 重定向、图片类型和单图大小校验

错误统一通过 `ROOM_ERROR` 事件回传给客户端，错误码使用 `ERROR_CODE` 枚举（`shared/types.ts`），包括：`NOT_IN_ROOM`、`ROOM_NOT_FOUND`、`NO_PERMISSION`、`INVALID_DATA`、`QUEUE_FULL`、`RATE_LIMITED`、`INTERNAL` 等。

`wss.ts` 在握手后只接受 `{ event, data }` JSON 信封，单条 WebSocket 消息上限为 1 MiB；事件负载继续由 shared Zod schema 和控制器权限层验证。

## 结构化日志（pino）

基于 [pino](https://github.com/pinojs/pino) 的薄封装，开发环境使用 `pino-pretty` 美化输出：

```typescript
logger.info('Room created', { roomId, socketId: socket.id })
logger.error('Failed to resolve stream URL', err, { roomId, trackId })
```

输出格式：`[ISO_TIMESTAMP] LEVEL message {JSON_CONTEXT}`

## 共享模式

## 类型驱动的事件系统

`EVENTS` 常量对象定义所有事件名，`ClientToServerEvents` / `ServerToClientEvents` 接口为每个事件定义精确的负载类型，确保前后端通信的类型安全。

## 构建优化

- **路由级懒加载**：`RoomPage` 和 `NotFoundPage` 使用 `React.lazy` + `Suspense`（`HomePage` 保持同步加载以保证首屏速度）
- **Vite manualChunks 分包**：react、motion、radix-ui、pixi.js 等大型依赖分别打包，利用浏览器长期缓存
- **React.memo**：列表项组件（`RoomCard`、`ChatMessage`、`TrackListItem`）和高频更新组件（`PlayerControls`）均使用 `React.memo` 避免不必要的 re-render
- **Zustand 细粒度 selector**：避免 `useRoomStore((s) => s.room)` 的粗粒度订阅，改用 `s.room?.name` 等精确字段

## 常量集中管理

`LIMITS` 和 `TIMING` 在 shared 包中统一定义，前后端共用：

```typescript
LIMITS.QUEUE_MAX_SIZE // 100
LIMITS.QUEUE_BATCH_MAX_SIZE // 100
LIMITS.CHAT_HISTORY_MAX // 200
TIMING.ROOM_GRACE_PERIOD_MS // 60_000
TIMING.PLAYER_NEXT_DEBOUNCE_MS // 500
TIMING.VOTE_TIMEOUT_MS // 30_000
NTP.INITIAL_INTERVAL_MS // 50
NTP.STEADY_STATE_INTERVAL_MS // 5_000
NTP.MAX_INITIAL_SAMPLES // 20
NTP.MIN_SCHEDULE_DELAY_MS // 300
NTP.MAX_SCHEDULE_DELAY_MS // 3_000
QR_STATUS.EXPIRED // 800
QR_STATUS.WAITING_SCAN // 801
QR_STATUS.SCANNED // 802
QR_STATUS.SUCCESS // 803
QR_TIMING.POLL_INTERVAL_MS // 2_000
QR_TIMING.SUCCESS_CLOSE_DELAY_MS // 1_000
```

---
