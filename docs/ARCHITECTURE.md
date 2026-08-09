# Desktop Architecture

## 进程边界

```text
Electron main
  -> BrowserWindow 生命周期、系统外链、窗口控制
  -> contextBridge 暴露最小 desktop API

React renderer
  -> 自有桌面 UI
  -> HTTP / WebSocket / HTMLMediaElement
  -> Zustand 单向状态
```

生产环境由主进程调用 `loadFile()` 加载 `dist/index.html`。渲染进程启用 `contextIsolation` 与沙箱，关闭 `nodeIntegration`，外部窗口统一拒绝并交给系统浏览器。

## 实时协议

`src/services/runtime.ts` 编排身份初始化、WebSocket 事件、房间状态、音频和歌词。消息沿用服务端信封：

```json
{ "event": "room:state", "data": {} }
```

连接先调用 `/api/auth/identity/bootstrap` 获取服务端隔离身份，再连接 `/ws`。重连间隔为 2、4、8、15、30 秒。NTP ping/pong 用于估算服务端时钟偏移，计划播放动作按 `serverTimeToExecute` 执行。

## 音频

`DesktopAudioPlayer` 独占 `HTMLAudioElement` 并通过单个动画帧时钟发布播放进度。B 站音频经过房间校验代理，酷狗与需要解密的资源经过酷狗代理，其他音源使用服务端下发的直连地址。

房间状态是播放意图来源。界面按钮只发送房间事件，不直接绕过房间权限或投票规则。

## 歌词

```text
TTML database / server lyric API
  -> parser.ts
  -> LyricLine[]
  -> engine.ts
  -> LyricGroup[] + interludes
  -> AMLL immutable adapter
  -> @applemusic-like-lyrics/react shared frame time
```

播放器视觉层保持与播放协议解耦。`BackgroundRender` 从经服务端代理的封面中提取四组主色，并按本地偏好选择 AMLL GPU 流体、模糊封面、动态渐变、纯色或无背景；它只读取播放状态和视觉偏好，不参与音频时钟与房间同步。流体模式默认采用 60 FPS / 100% 渲染精度，支持 5-60 FPS、25%-100% 精度以及静态降级；快捷设置另提供节能和平衡预设，模糊半径可独立调至 128px。播放暂停或系统启用“减少动态效果”时停止动态更新。AMLL 和舞台合成默认使用 Chromium GPU；显卡驱动不兼容时可通过 `--software-rendering` 启动参数或 `MT_SOFTWARE_RENDERING=1` 环境变量显式回退软件渲染。

沉浸模式只重排渲染层：隐藏标题栏、侧栏和房间面板，保留中央播放器与底部传输控制，并在空闲后淡出控件；`Escape` 可立即退出。歌词数据、Seek、房主权限和 WebSocket 事件路径均不因沉浸模式改变。

`PlayerVisualSettings` 是本机持久化的播放器表现模型，覆盖封面与歌词/仅歌词布局、背景、封面、控件和歌词动效。播放页快捷设置只写入该模型并即时预览；歌词总览、右键复制与进度悬停预览复用既有 `LyricGroup[]` 时间轴，所有跳转仍调用房间权限约束下的 `seekPlayback`。旧版“仅封面”配置在读取时迁移为封面与歌词布局，不再为低信息密度视图保留独立交互入口。

解析顺序与 Android 客户端一致：TTML、服务端逐词、YRC、LRC。辅助 LRC 在 500ms 容差内合并翻译与音译。TTML 保留逐词时间、Ruby、背景人声和对唱标记。

整形阶段移植 Android AMLL 算法：

1. 归一语义空格和行时间
2. 限制连续背景人声并与主句配对
3. 清理非预期短重叠
4. 在安全边界内提前 400-600ms 聚焦
5. 对至少 4 秒的空隙建立稳定间奏槽

当前行、逐词进度和滚动焦点全部消费 `DesktopAudioPlayer` 发布的同一时间，不创建独立歌词计时器。点击歌词会换算本地偏移后发送房间 Seek。

AMLL 仅承担渲染、滚动和逐字动画。`src/lyrics/amll.ts` 将桌面端已整形的时间轴转换为 AMLL 不可变模型，并关闭二次时间轴优化；播放时间由 Zustand 订阅直接写入 AMLL 播放器实例，避免音频帧推进触发整个歌词 React 子树重渲染。歌词偏移和点击跳转仍由 `DesktopAudioPlayer` 与房间事件驱动。播放器舞台沿用上游桌面端的 38/62 双栏结构，窄容器下隐藏封面概览以优先保证歌词可读性。

## 界面

桌面布局由左侧服务器/房间导航、中部播放器工作区、右侧队列/聊天和底部全宽传输控制组成。大厅阶段使用固定导航栏；进入房间后，左右面板转为覆盖在播放器之上的独立磨砂玻璃浮层，并分别维护展开状态。播放器通过 CSS 安全边距避让已展开面板，面板收起后只保留左侧无障碍唤回把手并释放中央舞台空间；右侧队列由底部传输控制统一唤回，隐藏面板使用 `inert` 移出键盘焦点顺序。浮层只使用合成友好的 `transform` 与 `opacity` 动画，不在过渡期间改变播放器内边距。底部传输控制保持固定几何位置，空闲时仅淡出歌曲信息、播放按钮、时长和操作区，进度轨道始终留在原位。最小窗口为 980x650；窄窗且双面板展开时优先隐藏封面概览，保证歌词可读性。
