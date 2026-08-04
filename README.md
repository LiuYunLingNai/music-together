# Music Together Desktop

Windows 与 Linux 原生桌面客户端。应用使用 Electron、React 和 TypeScript 构建自己的渲染进程界面，不加载既有网页地址。

## 开发

要求 Node.js 22 或更高版本。

```powershell
npm install
npm run dev
```

开发服务器位于 `http://127.0.0.1:5173`，Electron 仅在开发模式加载这个本地地址。`http://127.0.0.1:5173/?demo=1` 提供只在 Vite 开发模式生效的房间视觉预览，不会进入生产构建行为。

## 验证与打包

```powershell
npm run typecheck
npm test
npm run build
npm run dist:win
npm run dist:linux
```

### Windows 测试包与正式包

`npm run dist:win` 生成测试包。测试包会启用调试日志导出功能，方便收集测试问题；构建过程中会临时写入测试标记，并在结束后恢复工作区的 `package.json`。

`npm run dist:win:release` 生成正式包。正式包不显示日志导出入口，主进程也会拒绝导出请求。

GitHub Actions 的 `build-windows.yml` 与 Android 工作流一致：每次代码推送都会上传 Debug 测试包；仅版本号变化时才额外构建、上传并发布正式包。手动运行可选择 `debug` 或 `release`，并决定是否发布 GitHub Release。

输出位于 `release/`。Windows 目标包括 NSIS 安装包和 Portable，Linux 目标包括 AppImage 和 deb。

### 独立发版

Windows 与 Android 可以独立发布。Windows 工作流根据 `package.json` 的 `version` 创建 `windows-vX.Y.Z` Release；Android 工作流根据 `app/build.gradle.kts` 的 `versionName` 创建 `vX.Y.Z` Release。两端版本号可以相同，也不会互相覆盖。

当前工作区同时包含已验证的便携归档：`portable/Music-Together-2.2.5-windows-x64.zip` 与 `portable/Music-Together-2.2.5-linux-x64.tar.gz`，校验值见 `portable/SHA256SUMS.txt`。

## 主要能力

- 安全的 Electron 主进程和最小化预加载桥接
- Music Together 身份初始化、房间发现、断线重连和 NTP 校时
- 房间创建/加入、密码房、队列、搜索点歌和聊天
- HTML 音频播放、B 站/酷狗服务端代理与房间播放控制
- TTML、服务端逐词、YRC、LRC、翻译、音译、Ruby 和背景人声
- Apple Music 风格逐词遮罩、强调、焦点滚动、手动浏览与歌词偏移
- Windows 安装版自动检查 `windows-v*` Release，下载后校验 SHA-256 并启动安装更新；Portable 版需手动下载安装包

架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
