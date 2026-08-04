<p align="center">
  <img alt="Music Together" src="public/logo.svg" width="80">
</p>

<h1 align="center">Music Together</h1>

<p align="center">
  A real-time collaborative listening platform. Run one server, then join the same rooms, queue, and synchronized playback from the web, Android, or Windows desktop client.
</p>

<p align="center">
  <a href="README.md">Simplified Chinese</a>
</p>

## Overview

Music Together consists of a Node.js server and several clients. The server coordinates rooms, identities, queues, voting, chat, and playback timing. Clients render the experience, play audio, and integrate with their host platform. All clients use the same HTTP and WebSocket protocol, so they can join the same room across devices.

| Platform | Implementation | Current location | Best for |
| --- | --- | --- | --- |
| Web | React + Vite | `main` branch | Browsers, mobile browsers, and quick deployment |
| Android | Kotlin + Jetpack Compose + Media3 | `codex/android-native-client`, v2.2.5 | Native background playback, system media controls, and multi-server lobby |
| Windows desktop | Electron + React + TypeScript | `codex/windows-native-client` | Installed desktop experience and standalone windows |

> The Android and desktop clients are currently maintained in their own branches and do not include the server. Deploy or run the `main` branch server first, then configure its address in the client.

## Screenshots

### Web Desktop

| 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| ![Web desktop screenshot 1](screenshots/1.png) | ![Web desktop screenshot 2](screenshots/2.png) | ![Web desktop screenshot 3](screenshots/3.png) | ![Web desktop screenshot 4](screenshots/4.png) | ![Web desktop screenshot 5](screenshots/5.png) |

### Web Mobile

| 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| ![Web mobile screenshot 1](screenshots/1_m.png) | ![Web mobile screenshot 2](screenshots/2_m.png) | ![Web mobile screenshot 3](screenshots/3_m.png) | ![Web mobile screenshot 4](screenshots/4_m.png) | ![Web mobile screenshot 5](screenshots/5_m.png) |

### Native Android Client

| Launch | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| ![Android launch screen](screenshots/0_a.jpg) | ![Android screenshot 1](screenshots/1_a.jpg) | ![Android screenshot 2](screenshots/2_a.jpg) | ![Android screenshot 3](screenshots/3_a.jpg) | ![Android screenshot 4](screenshots/4_a.jpg) |

### Windows Desktop Client

| 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| ![Windows desktop screenshot 1](screenshots/1_w.png) | ![Windows desktop screenshot 2](screenshots/2_w.png) | ![Windows desktop screenshot 3](screenshots/3_w.png) | ![Windows desktop screenshot 4](screenshots/4_w.png) | ![Windows desktop screenshot 5](screenshots/5_w.png) |

## Capabilities

- Real-time room synchronization with clock correction, scheduled actions, progress reporting, and drift correction
- NetEase Cloud Music, QQ Music, Kugou, Kugou Concept, and Bilibili sources
- Platform sign-in and playlists through QR/Cookie login, with quality selection based on account capability
- Rooms, password rooms, invite links, queue management, chat, roles, votes, and hidden rooms
- Sequential, single-loop, list-loop, and shuffle playback with word-by-word, translated, romanized, and Ruby lyrics
- One shared room protocol across the web, Android native player, and Windows desktop client

## Architecture

```text
Web client / Android client / Windows desktop client
                    │ HTTP + WebSocket
                    ▼
          Music Together Node.js server
                    │
     Rooms, clock sync, authentication, music and lyric proxy
```

The server persists room data and server-side account configuration. Music-platform cookies are sent only to the connected Music Together server. Bilibili and proxy-required audio are routed through the server so platform credentials are not exposed to other room members.

## Web and Server Development

### Prerequisites

- Node.js 22+
- pnpm 10+

### Start locally

```powershell
git clone https://github.com/LiuYunLingNai/music-together.git
cd music-together
pnpm install --frozen-lockfile
pnpm dev
```

- Web client: `http://localhost:5173`
- Server: `http://localhost:3001`

In default auto mode, the web client connects to the server at its current origin. Set `CLIENT_URL` when deploying frontend and backend separately or when an explicit origin allowlist is required.

## Android Client

The Android app is native, not a WebView wrapper. It uses Kotlin, Jetpack Compose, OkHttp WebSocket, and Media3 ExoPlayer. It supports a multi-server lobby, background playback, system media controls, chat, queue management, search, platform accounts/playlists, votes, and word-by-word lyrics.

### Build a debug APK

Requires JDK 17-21 (the Android Studio bundled JBR is recommended) and Android SDK 36:

```powershell
git clone --branch codex/android-native-client --single-branch https://github.com/LiuYunLingNai/music-together.git
cd music-together/packages/android-client
.\gradlew.bat testStandardDebugUnitTest assembleStandardDebug
```

The APK is written to `app/build/outputs/apk/standard/debug/app-standard-debug.apk`.

- Android emulator to a server on the development machine: `http://10.0.2.2:3001`
- Physical device on a LAN: use the computer's LAN address, for example `http://192.168.1.8:3001`
- Use HTTPS for public servers. The app can store multiple server addresses and aggregate their rooms in one lobby.

The Android branch ships `standard` and `vivo` variants. Its GitHub Actions workflow builds Debug/Release APKs and a standard AAB.

## Windows Desktop Client

The desktop client is an Electron, React, and TypeScript application with its own interface rather than loading the web app URL. The current branch builds Windows installers and portable executables, while retaining AppImage and deb Linux targets.

It includes server connection settings, room discovery and reconnecting, NTP clock sync, rooms/password rooms, search, queue, chat, transport controls, and Apple Music-style lyrics.

### Develop and package

Requires Node.js 22+:

```powershell
git clone --branch codex/windows-native-client --single-branch https://github.com/LiuYunLingNai/music-together.git
cd music-together
npm ci
npm run dev
```

Useful verification and packaging commands:

```powershell
npm run typecheck
npm test
npm run build
npm run dist:win
```

Artifacts are written to `release/`. Windows targets are NSIS and Portable. Run `npm run dist:linux` for AppImage and deb packages.

## Deploy the Server with Docker

```bash
docker run -d --name music-together --restart unless-stopped \
  -p 3001:3001 \
  -v /path/to/music-together-data:/app/data \
  ghcr.io/LiuYunLingNai/music-together:latest
```

Replace `/path/to/music-together-data` with a persistent host directory. It holds the server database and account-related data; recreating a container without the mount loses that data.

When serving HTTPS through Nginx, Caddy, 1Panel, or another reverse proxy, forward `X-Forwarded-Proto` so the server can set secure cookies correctly. Configure public clients with the proxied HTTPS address.

## Repository Layout

The `main` branch:

```text
packages/
  client/   Web React app
  server/   Node.js server
  shared/   Shared types, constants, and permissions
```

Native-client branches:

```text
codex/android-native-client
  packages/android-client/   Kotlin/Compose Android app

codex/windows-native-client
  electron/ + src/           Electron desktop app
```

## Documentation

- [Web and server architecture](docs/PROJECT_ARCHITECTURE.md)
- [Android client README](https://github.com/LiuYunLingNai/music-together/tree/codex/android-native-client/packages/android-client)
- [Windows desktop client README](https://github.com/LiuYunLingNai/music-together/tree/codex/windows-native-client)

## License

[AGPL-3.0](LICENSE)
