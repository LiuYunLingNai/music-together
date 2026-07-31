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
  -> LyricsView shared frame time
```

解析顺序与 Android 客户端一致：TTML、服务端逐词、YRC、LRC。辅助 LRC 在 500ms 容差内合并翻译与音译。TTML 保留逐词时间、Ruby、背景人声和对唱标记。

整形阶段移植 Android AMLL 算法：

1. 归一语义空格和行时间
2. 限制连续背景人声并与主句配对
3. 清理非预期短重叠
4. 在安全边界内提前 400-600ms 聚焦
5. 对至少 4 秒的空隙建立稳定间奏槽

当前行、逐词进度和滚动焦点全部消费 `DesktopAudioPlayer` 发布的同一时间，不创建独立歌词计时器。点击歌词会换算本地偏移后发送房间 Seek。

## 界面

桌面布局由左侧服务器/房间导航、中部歌词或封面工作区、右侧队列/聊天和底部全宽传输控制组成。最小窗口为 980x650；窄窗下封面由横向双列切换为上下布局。
