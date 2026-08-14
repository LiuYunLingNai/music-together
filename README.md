# Music Together Android

Music Together 的原生 Android 客户端，使用 Kotlin、Jetpack Compose、OkHttp WebSocket 和 Media3 ExoPlayer 实现，不是 WebView 套壳。

本分支只维护 Android 客户端。Music Together Web 客户端和服务端源码位于 [`main`](https://github.com/LiuYunLingNai/music-together/tree/main) 分支。

## 功能

- 同时连接多个 Music Together 服务器，聚合房间列表并选择目标房间
- 在指定服务器创建房间，支持密码房间、离开和断线重进
- 原生音频播放、MediaSession、NTP 校时、播放进度同步与漂移修正
- 播放控制、队列、聊天室、成员权限和投票
- 网易云音乐、QQ 音乐、酷狗音乐搜索、歌单与平台账号
- 服务器账号、头像、密码和管理员功能
- 逐词歌词、横竖屏布局和 Android 媒体通知
- Material 3 / MIUIX 双视觉体系与分级设置页；MIUIX 可选实时模糊悬浮底栏，Material 3 保持标准导航
- 可调歌词字号、字重、焦点位置、翻译/音译、动画效果与流体背景强度

## 构建

需要 JDK 21（推荐兼容版本的 Android Studio 内置 JBR）和 Android SDK 37.0。应用输出字节码仍以 JVM 17 为目标，`targetSdk` 仍为 36。

```powershell
cd packages/android-client
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
.\gradlew.bat testStandardDebugUnitTest assembleStandardDebug
```

Debug APK 输出到：

```text
packages/android-client/app/build/outputs/apk/standard/debug/app-standard-debug.apk
```

项目还包含 `vivo` 分发变体，可通过 `assembleVivoDebug` 构建。

## 连接服务器

应用支持 HTTP 和 HTTPS 服务端地址。Android 模拟器访问电脑本机服务端时使用 `http://10.0.2.2:3001`；真机使用电脑的局域网 IP。公网环境建议使用 HTTPS。

## 目录

```text
packages/android-client/
  app/                 Android 应用源码与测试
  gradle/              Gradle Wrapper
  build.gradle.kts     Android 构建配置
  settings.gradle.kts  Gradle 工程设置
```

## 协议

[AGPL-3.0](LICENSE)
