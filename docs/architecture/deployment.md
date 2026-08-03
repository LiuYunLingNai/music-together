# 部署方案

## 架构

采用纯 Node.js 单镜像：Express 同时托管前端 SPA、REST API 和 Socket.IO。

```text
Docker 容器 (:3001)
├── /                 client/dist
├── /api/*            REST API
└── /socket.io/*      Socket.IO
```

## CI/CD

GitHub Actions 分为两个阶段：

1. Pull Request 和 main push 都执行依赖安装、Vitest、前端 typecheck/lint、workspace build 和生产依赖 critical 审计。
2. 只有非 PR 且验证通过后，才构建并推送 `latest` 和 commit SHA 两个 GHCR 标签。

Dependabot 每周检查 pnpm 依赖，并按月检查 GitHub Actions 和 Docker 基础镜像。

## 必需的生产配置

生产环境必须设置至少 32 字符的随机 `IDENTITY_SECRET`：

```bash
openssl rand -base64 48
```

然后通过容器环境变量传入。未设置时服务会拒绝启动。

其他变量详见根目录 `.env.example`：

```text
PORT
CLIENT_URL
CORS_ORIGINS
IDENTITY_SECRET
IDENTITY_TTL_DAYS
REJOIN_TTL_MS
IDENTITY_COOKIE_SECURE
AUTO_FALLBACK_ENABLED
```

## Docker 多阶段构建

- `deps`：锁定 pnpm 10.29.2 并执行 frozen install。
- `build`：构建 shared、server 和 client。
- `production`：只安装服务端生产依赖链，复制构建产物。
- 运行时使用非 root `node` 用户。
- 容器通过 `/api/health` 执行 Docker `HEALTHCHECK`。

## CORS 与 Cookie

- `CLIENT_URL` / `CORS_ORIGINS` 未设置：自动来源模式，适合同域镜像和局域网部署。
- 显式设置来源：严格白名单模式，适合前后端分离。
- `IDENTITY_COOKIE_SECURE` 未设置时，根据生产环境和当前请求协议自动判断。
- HTTPS 反向代理必须透传 `X-Forwarded-Proto`。

## 部署示例

```bash
docker run -d \
  --name music-together \
  --restart unless-stopped \
  -p 3001:3001 \
  -e IDENTITY_SECRET='<至少32字符的随机密钥>' \
  ghcr.io/yueby/music-together:latest
```

检查健康状态：

```bash
docker inspect --format '{{json .State.Health}}' music-together
curl http://127.0.0.1:3001/api/health
```

如使用 1Panel、Nginx 或 Caddy，反向代理到 `127.0.0.1:3001`，启用 WebSocket，并正确传递来源协议头。

Watchtower 可用于自动更新镜像，但其 Docker Socket 权限较高；使用前应理解其安全边界，并限制为指定容器。
