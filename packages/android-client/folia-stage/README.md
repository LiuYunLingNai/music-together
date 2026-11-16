# Folia 安卓沉浸舞台

房间播放器菜单 → 沉浸模式。点按屏幕显示/隐藏控制栏，右上角调色板选择舞台，滑条图标打开舞台配置；返回先关闭配置/选择器，再退出沉浸模式。配置打开时竖屏使用底部面板、横屏使用侧栏，舞台继续显示实时效果。

本模块嵌入原始 Folia Web 渲染器，并用原生播放器供给歌词、进度、暂停和频谱。20 种内建舞台全部纳入：商籁、花火、町景、流光、提示词、心象、云阶、浮名、莫奈、雾笺、绘光、镜台、群唱、回环、时计、凝彩、倾诉、文字 PV、静止、纯背景。它们保留各自的 React、Pixi、Three 或 JIZURA 引擎，并非 20 个共用模板。

## 舞台配置

- 舞台：复用上游各样式的完整参数面板、参数范围与默认值，镜头、排版、装饰、颜色、粒子、后处理和各样式渲染质量覆盖实时生效；无独立参数的舞台仍可调整通用显示。
- 背景：保留舞台默认，另可选择纯色及上游 Common、Latent、Monet、Nomand、Sonic、Sora、Particles 7 种内建背景，各自的设置面板一并接入。
- 文字：歌词字号、字重、字体风格、自定义 TTF/OTF/WOFF/WOFF2 文件、主/副文字与背景配色、动画强度。
- 字幕：原文/下一句/翻译/音译的 1–3 行组合、附加字幕内容、独立字号/字重/字体、不透明度、底板和下一句模糊。默认跟随原生播放器；舞台独立选择时可重新启用翻译/音译。
- 性能：静态舞台/背景、关键词着色、全局分辨率和抗锯齿。样式独立覆盖沿用上游解析，未覆盖的值跟随全局。
- 素材：群唱自定义表情/头像、莫奈肖像/背景、凝彩画布图片使用上游上传和管理界面；二进制记录保存在专用 IndexedDB，Blob URL 随 WebView 生命周期释放并在重建后恢复。
- 文字 PV：打开上游原版 JIZURA 编辑台，按曲目保存工程，歌词、进度、播放/暂停与 Android 播放器联动。

设置使用舞台本地存储，不改变网络、房间或原生播放器偏好。滑条即时预览、松手持久化，关闭页面和失焦提交待写值；恢复默认只作用于当前分类。上传文件使用 Android 系统文件选择器，选择期间保留发起请求的 WebView，暂停原生帧/FFT 任务。

舞台通过上游 entry.render 挂载，保留雾笺参数注入和心象字号适配。面板只启用当前舞台确实消费的选项：封面隐藏用于莫奈，未支持的静态/强度/画布质量选项禁用并说明，凝彩智能拍点相关的景深控制尚不可用。静止舞台的翻译与音译改用共享字幕配置；雾笺的共用背景选项接入背景层。静态背景会冻结只提供暂停接口的 Sonic/Particles 等背景。

文件上传统一使用 ACTION_OPEN_DOCUMENT，并读取单文件 URI 和多选 ClipData；避免旧 WebView 无法消费 Android Photo Picker 的图片授权。设置面板按实际 CSS 宽高布局，旧 WebView 的 color-mix 不可用时使用深色设置令牌回退，滑条轨道仍可见。

## 构建与验证

需要 Node.js 24、npm 和 tar（Windows 10+ 自带）。在本目录运行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run test:render
```

浏览器测试默认使用 Playwright Chromium；可用环境变量 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定已安装的 Chrome/Edge。首次使用默认浏览器先运行 npx playwright install chromium。截图与运行报告写入忽略目录 .work/。

测试覆盖 20 个舞台及参数面板、横竖屏长歌词与放大字号、暂停后懒加载/异步分词、Seek、7 种背景、参数保存/恢复/重置、上传图片持久化和 JIZURA 编辑台加载。

ADB 模拟器测试可运行 `FoliaWebViewTest` 和 `FoliaChosenFilesTest`；`FoliaSettingsDeviceTest` 仅在显式传入 `-e foliaSettingsAudit true` 时启动真实离线舞台检查会话，默认跳过。会话内的文件选择和本地数据仍属于该 WebView；测试结束会释放视图。

Gradle preBuild 自动运行构建并将输出写入 app/build/generated/foliaAssets，避免提交 JS 编译产物。CI 安装同一 package-lock.json；Android Standard/vivo 均嵌入同一份资源。

upstream-source.tar.gz 是固定上游版本的原始源码最小依赖闭包，prepare.mjs 校验 upstream-source.sha256 后解包至 .work/。原文件保持版权标记；安卓宿主适配单独存放于 src/，路径边界由 vite.config.mjs 管理。来源、提交和授权见 UPSTREAM.md 与 LICENSE.folia。更新上游时须重建快照、校验 SHA-256，并运行所有舞台测试和 Android Debug 门禁。

扩展快照可在本目录运行 `node scripts/snapshot.mjs <上游工作区>`，脚本要求上游 HEAD 与 UPSTREAM.md 一致，收集原快照与舞台/设置/背景新增依赖闭包，不改写原文件。Vite 的宿主适配在构建时初始化逐词/词组的当前时钟状态，避免暂停后挂载或异步分词完成时停留在隐藏态。

## 兼容边界

- 所有舞台内置默认效果已接入；文字/字幕默认沿用原生设置，可在舞台配置中独立覆盖。
- 封面、曲目、歌词通过原生状态供给；网络登录、房间同步、MediaSession 始终由 Android 管理。
- 频谱输入来自已有 80–2000 Hz FFT，不提供真实全频谱或 htdemucs 分轨；依赖分轨/beat_this 的附加效果未启用。
- AI 主题与联网素材市场、MV/URL 嵌入背景、场景与 Folium 模组未迁移；需要 Folia 账户、服务器或原生分析模型的功能不出现在配置中。
- JIZURA 编辑与工程持久化已接入；视频/图片序列/AE 导出及凝彩素材库导出未接入 Android 保存位置选择器。
- 陀螺仪和自由相机背景手势尚未接入；本地背景参数与音频响应可用。
- 雾笺暂使用原始字体骨架回退；本次笔顺数据下载失败，不包含 AnimCJK 数据。
- WebGL 效果取决于设备与 Android System WebView；不支持受来源限制的消息通道时显示更新提示。真机性能仍需设备验证。
