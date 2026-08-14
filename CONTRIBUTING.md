# 参与贡献

## 开发环境

- Node.js 22（具体版本见 `.node-version`）
- pnpm 10.29.2

安装依赖：

```bash
pnpm install
```

仅在需要联调时启动开发服务：

```bash
pnpm dev
```

## 提交前检查

```bash
pnpm --filter @music-together/server test
pnpm test
pnpm typecheck
pnpm --filter @music-together/client lint
pnpm build
pnpm audit --prod --audit-level high
```

默认测试不得请求真实的网易云、QQ 音乐、酷狗或哔哩哔哩接口。修复缺陷和修改业务规则时应附带回归测试。

## 架构兼容

- Web 客户端位于 `packages/client`，服务端位于 `packages/server`，共享协议位于 `packages/shared`。
- 原生客户端使用 `/ws` JSON 协议；共享载荷变更必须保持 Android 和 Windows 兼容。
- 服务端拥有播放时间线的最终权威；客户端只执行计划动作并依据服务端快照纠偏。
- 不得用上游实现覆盖本 fork 的永久房间、离线成员、后台管理、多平台音源、音质、下载和原生客户端支持。

Pull Request 请说明变更范围、兼容性影响、执行过的校验和文档更新。禁止提交 `.env`、Cookie、令牌、密码、数据库、构建产物和临时文件。
