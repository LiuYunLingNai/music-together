# Music Together Android

这是 Music Together 的原生 Android 客户端，使用 Kotlin、Jetpack Compose、OkHttp WebSocket 和 Media3 ExoPlayer 实现，不是 WebView 套壳。

## 已支持

- 自定义 HTTP/HTTPS 服务端 URL（局域网 HTTP 也可使用）
- 身份 Cookie 初始化、WebSocket 连接与断线重连
- 房间列表、创建房间、密码房间、加入/离开与断线重进
- 原生音频播放、NTP 校时、定时播放控制、进度上报与漂移修正
- 播放/暂停、上下曲、进度跳转和播放模式
- 网易云、QQ 音乐、酷狗音乐搜索与点歌
- 服务器持久化账号、昵称/头像/账号 ID、密码保护、登录与退出
- 服务器管理员账号与活跃房间治理
- 按音源账号权限选择无损、Hi-Res、空间音频及母带音质
- 播放队列、聊天室、成员列表和普通成员投票控制

## 构建

需要 JDK 17-21（推荐 Android Studio 内置 JBR）与 Android SDK 36：

```powershell
cd packages/android-client
./gradlew.bat assembleDebug
```

APK 输出路径：`app/build/outputs/apk/debug/app-debug.apk`。

Android 模拟器访问电脑本机服务端时，默认地址是 `http://10.0.2.2:3001`；真机请填写电脑的局域网 IP，例如 `http://192.168.1.8:3001`。公网环境建议使用 HTTPS。
