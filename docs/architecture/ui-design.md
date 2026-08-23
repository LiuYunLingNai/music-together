# UI 设计规范

## 组件库

- **shadcn/ui**：`new-york` 风格变体，`neutral` 基色
- **配置**：非 RSC（`"rsc": false`），使用 CSS 变量，Lucide 图标
- **安装路径**：`@/components/ui/`，工具函数 `@/lib/utils`

## 颜色系统

使用 **oklch 色彩空间**，单一深色主题，CSS 变量直接定义在 `:root`（无亮/暗切换）：

```css
:root {
  --background: oklch(0.178 0.005 265); /* 深蓝灰 */
  --foreground: oklch(0.985 0 0); /* 近白 */
  --primary: oklch(0.922 0 0); /* 亮色主色 */
  --card: oklch(0.235 0.008 265); /* 微蓝灰卡片 */
  --accent: oklch(0.35 0.008 265); /* 强调色 */
  /* ... */
}
```

## 字体

- **主字体**：Plus Jakarta Sans（通过 `@fontsource/plus-jakarta-sans` 本地打包）
- **回退**：system-ui, -apple-system, sans-serif

## 圆角

基准值 `--radius: 0.625rem`，其他圆角通过计算派生：

```css
--radius-sm: calc(var(--radius) - 4px); /* 小 */
--radius-md: calc(var(--radius) - 2px); /* 中 */
--radius-lg: var(--radius); /* 标准 */
--radius-xl: calc(var(--radius) + 4px); /* 大 */
```

## 图标

使用 **lucide-react**，按需导入：

```typescript
import { Play, Pause, SkipForward, Volume2 } from 'lucide-react'
```

成员列表使用浏览器、手机和桌面端图标展示服务端识别出的粗粒度连接设备；同一账号在多个设备在线时并列显示全部标签，相同标签显示连接数量。离线成员保留最后一次识别到的标签，未知或无法安全识别的 User-Agent 不展示设备信息。

## 动画

- **motion (Framer Motion)**：组件进入/退出动画、列表动画
- **tw-animate-css**：Tailwind 动画预设类
- **自定义动画**：`float` 关键帧（6s 缓动上下浮动）、`marquee` 关键帧（文本溢出自动滚动）

```css
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

@keyframes marquee {
  0%,
  15% {
    transform: translateX(0);
  }
  45%,
  55% {
    transform: translateX(var(--marquee-distance));
  }
  85%,
  100% {
    transform: translateX(0);
  }
}
```

## MarqueeText 组件

`marquee-text.tsx` 通用文本溢出自动滚动组件，用于播放列表项、SongInfoBar、NowPlaying compact 模式等场景：

- 使用 `ResizeObserver` 检测文本是否溢出容器（`scrollWidth > clientWidth`）
- 溢出时通过 CSS `translateX` 动画实现 pause-scroll-pause 循环（GPU 加速）
- 动画时长根据溢出距离动态计算（`Math.max(5, 4 + overflow / 30)`），长文本滚动更慢
- 未溢出时无动画，等同普通文本
- 遵循 `prefers-reduced-motion` 系统偏好（已有全局 `animation-duration: 0.01ms` 降级）

## 滚动条

自定义 WebKit 滚动条：6px 宽/高，透明轨道，半透明滑块。Firefox 使用 `scrollbar-width: thin`。`.scrollbar-hide` 工具类隐藏滚动条但保持滚动功能（用于移动端设置导航栏等）。

## 歌词渲染

- **AMLL** (`@applemusic-like-lyrics/react`)：Apple Music 风格逐行/逐词歌词动画；歌词设置可控制渐变宽度、已播放行隐藏、敏感词遮罩和末尾歌曲信息，同时保留逐曲时间偏移校准。末尾歌曲信息使用 AMLL 官方 `bottomLine` 插槽，不进入可播放歌词时间轴；TTML 与平台歌词并行获取，无有效时长的 TTML 行优先通过同源 LRC 恢复，仍有冲突时由服务端按歌曲名、全部歌手和时长严格匹配酷狗 KRC，必要时回退 QQ LRC。补全只替换异常行并校正来源整体时间偏移，随后以“主歌词＋附属背景人声”为组稳定排序，避免破坏既有逐字、对唱和背景人声结构
- **逐词来源**：TTML 在线库（网易云/QQ）、平台原生 YRC（网易云）、平台原生 KRC（酷狗，服务端解析后以 `wordByWord` 返回）
- **PixiJS 背景**：`BackgroundRender` 组件使用 PixiJS 渲染动态专辑封面背景
- **单击跳转**：房主和管理员可单击真实歌词行，通过服务端权威 Seek 同步房间进度；跳转时间包含当前歌曲的歌词偏移校准，并排除末尾歌曲信息行和时长未就绪状态。歌词点击不提前改写本地播放时间，在服务端预定时刻只执行一次 AMLL Seeking 弹簧滚动，避免乐观更新与权威广播重复定位造成抽搐；进度条仍保留本地预览。网络硬纠偏等恢复操作继续强制定位，避免动画损害同步精度
- 歌词设置可调：对齐锚点、弹簧动画、模糊效果、缩放效果、字重、字体大小、翻译字体大小
- 房主设置提供私人漫游开关、平台选择和模式选择。网易云展示默认、熟悉、探索、运动、专注、深夜、AI DJ；QQ 音乐和酷狗的模式选择禁用并显示固定默认推荐。
- 私人漫游设置在移动端继续使用 `SettingRow`、`Switch` 和 `Select`，控件宽度限制在视口内；房主未登录所选平台时显示就地说明并阻止开启，服务端仍执行最终校验。
- 房主设置提供“播放后移除歌曲”开关，默认关闭；开启后由服务端在成功切到不同歌曲时更新队列，客户端只展示权威房间状态。

## 样式工具函数

```typescript
// cn() — 条件 class 合并（clsx + tailwind-merge）
import { cn } from '@/lib/utils'

<div className={cn('base-class', isActive && 'active-class')} />
```

## Toast 通知

使用 **sonner**，定位在顶部居中：

```typescript
<Toaster position="top-center" richColors />
```

## 房间热歌榜

房间播放页提供可切换的官方热歌榜。桌面端的热歌榜和聊天面板以悬浮层覆盖在播放器舞台两侧，播放器外框和流体背景尺寸保持不变；封面、歌词和控件所在的前景安全区随面板平滑缩进，继续触发播放器现有的横竖布局、封面宽度和控件缩放适配，避免遮挡核心信息。面板上下保留 `clamp(18px, 3vh, 32px)` 间距，让同一流体背景延伸到深色毛玻璃面板下方。`1600px` 及以上允许同时展开两侧，`1024px` 至 `1599px` 的热歌榜和聊天互斥；热歌榜在 `1024px` 以下、聊天在 `768px` 以下继续使用底部抽屉。精细指针悬停时，面板高光通过 `requestAnimationFrame` 跟随指针且不触发 React 重渲染；触控和减少动态效果环境保持静态高光。

榜单顶部使用三段式切换 `网易 / QQ / 酷狗`，并记住用户上次选择；各平台分别加载和缓存，避免一次请求全部榜单。列表首批加载 30 首，滚动接近底部时按 30 首继续分页加载。榜单展示排名、封面、歌名和歌手，前三名使用强调色；点击加号或双击歌曲会复用房间现有点歌入口，队列中已有歌曲显示完成状态。加载时使用 Skeleton，并提供错误、空列表、加载更多和手动刷新状态。

播放器可切换为房间歌单视图；歌单视图底部的迷你播放器在歌曲信息与播放控制之间展示当前歌词，右侧时间区域作为歌单入口。队列封面优先直接加载缩略图或完整 CDN 图片，失败后再回退服务器封面代理，减少长队列产生的不必要服务端流量。

## 触控与 Hover 双模式

项目将**布局**和**交互**解耦为两个正交维度：

| Hook            | 维度 | 媒体查询                  | 控制内容                                      |
| --------------- | ---- | ------------------------- | --------------------------------------------- |
| `useIsMobile()` | 布局 | `(orientation: portrait)` | Drawer 方向、面板高度、Dialog vs Drawer       |
| `useHasHover()` | 交互 | `(hover: hover)`          | hover 工具栏 vs tap 展开、Slider thumb 可见性 |

横屏手机 = `isMobile: false`（使用桌面布局）+ `hasHover: false`（使用触控交互）。

- **Slider Thumb**：进度条 Thumb 默认透明，桌面端 `group-hover` 显示，触控设备通过 `focus:opacity-100` 在触摸拖拽时显示
- **触控目标尺寸**：所有可点击按钮在移动端通过 `min-h-11 min-w-11`（44px）扩大触控热区，桌面端 `sm:min-h-0 sm:min-w-0` 还原视觉尺寸。涉及 QueueDrawer 工具栏、VoteBanner、RoomHeader
- **QueueDrawer tap-to-expand**：触控设备（`isTouch = !hasHover`）点击列表项展开操作工具栏；桌面端通过 `group-hover` 显示工具栏。两种模式在横屏手机上都能正确工作

## 封面图片 onError 回退

- **NowPlaying**：使用 `coverError` state 追踪加载失败，切歌时重置；失败后回退到 `Disc3` 占位图标
- **QueueDrawer**：`<img>` 的 `onError` 隐藏图片并显示 `Music` 占位图标（始终渲染占位 div，通过 `hidden` class 切换）

## 音频加载失败重试

`useHowl` 的 `onloaderror` 处理：

- 首次失败自动重试一次（`retryRef` flag + `howl.load()`）
- 重试仍失败则 toast 显示歌曲名（`trackTitleRef`）并跳到下一首
- `onloaderror` 开头有 stale guard（`howlRef.current !== howl`），防止旧 Howl 实例的重试回调影响新曲
- `loadTrack` 时重置 retry flag 和歌曲名 ref，并清理 `playErrorTimerRef`（防止上一首的 play-error 超时跳过新曲）
- `onload` 和 `onplay` 中对 `howl.duration()` 做 `Number.isFinite` + `> 0` 校验，防止流式加载时无效 duration 写入 store
- `queueAddSchema` 对 `duration` 做 `z.number().finite().nonnegative()` 校验，从数据入口杜绝无效时长

---
