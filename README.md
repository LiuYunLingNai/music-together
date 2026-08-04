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

输出位于 `release/`。Windows 目标包括 NSIS 安装包和 Portable，Linux 目标包括 AppImage 和 deb。

### 统一发版

Windows 与 Android 使用同一个 GitHub Release。发版时将 Windows 的 `package.json` `version` 与 Android 的 `app/build.gradle.kts` `versionName` 设置为相同版本（例如 `1.0.0`），分别推送对应分支；两个工作流会共同创建或更新 `v1.0.0`，把 Windows 安装包、Portable、Android APK 和 AAB 放在同一条 Release 中。无需手动重复创建 Release。

当前工作区同时包含已验证的便携归档：`portable/Music-Together-1.0.0-windows-x64.zip` 与 `portable/Music-Together-1.0.0-linux-x64.tar.gz`，校验值见 `portable/SHA256SUMS.txt`。

## 主要能力

- 安全的 Electron 主进程和最小化预加载桥接
- Music Together 身份初始化、房间发现、断线重连和 NTP 校时
- 房间创建/加入、密码房、队列、搜索点歌和聊天
- HTML 音频播放、B 站/酷狗服务端代理与房间播放控制
- TTML、服务端逐词、YRC、LRC、翻译、音译、Ruby 和背景人声
- Apple Music 风格逐词遮罩、强调、焦点滚动、手动浏览与歌词偏移

架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
