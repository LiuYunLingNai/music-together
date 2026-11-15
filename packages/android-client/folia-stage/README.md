# Folia 安卓沉浸舞台

房间播放器菜单 → 沉浸模式。点按屏幕显示/隐藏控制栏，右上角调色板选择舞台；返回先关闭选择器，再退出沉浸模式。

本模块嵌入原始 Folia Web 渲染器，并用原生播放器供给歌词、进度、暂停和频谱。20 种内建舞台全部纳入：商籁、花火、町景、流光、提示词、心象、云阶、浮名、莫奈、雾笺、绘光、镜台、群唱、回环、时计、凝彩、倾诉、文字 PV、静止、纯背景。它们保留各自的 React、Pixi、Three 或 JIZURA 引擎，并非 20 个共用模板。

## 构建与验证

需要 Node.js 24、npm 和 tar（Windows 10+ 自带）。在本目录运行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run test:render
```

浏览器测试默认使用 Playwright Chromium；可用环境变量 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定已安装的 Chrome/Edge。首次使用默认浏览器先运行 npx playwright install chromium。截图与运行报告写入忽略目录 .work/。

Gradle preBuild 自动运行构建并将输出写入 app/build/generated/foliaAssets，避免提交 JS 编译产物。CI 安装同一 package-lock.json；Android Standard/vivo 均嵌入同一份资源。

upstream-source.tar.gz 是固定上游版本的原始源码最小依赖闭包，prepare.mjs 校验 upstream-source.sha256 后解包至 .work/。原文件保持版权标记；安卓宿主适配单独存放于 src/，路径边界由 vite.config.mjs 管理。来源、提交和授权见 UPSTREAM.md 与 LICENSE.folia。更新上游时须重建快照、校验 SHA-256，并运行所有舞台测试和 Android Debug 门禁。

## 兼容边界

- 所有舞台内置默认效果已接入；字幕字号、字重、翻译和音译沿用原生设置。
- 封面、曲目、歌词通过原生状态供给；网络登录、房间同步、MediaSession 始终由 Android 管理。
- 频谱输入来自已有 80–2000 Hz FFT，不提供真实全频谱或 htdemucs 分轨；依赖分轨/beat_this 的附加效果未启用。
- AI 主题、Folia 设置编辑器、自定义头像/画布图片、上传字体、背景库/MV/URL 图层和 Folium 模组未迁移。文字 PV 本地 JIZURA 渲染已接入，编辑器文件导出显示不支持。
- 雾笺暂使用原始字体骨架回退；本次笔顺数据下载失败，不包含 AnimCJK 数据。
- WebGL 效果取决于设备与 Android System WebView；不支持受来源限制的消息通道时显示更新提示。真机性能仍需设备验证。
