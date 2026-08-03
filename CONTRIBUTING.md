# Contributing

## Requirements

- Node.js 22.22.0 or newer
- pnpm 10 or newer

## Setup

```bash
pnpm install
```

Start development services only when needed:

```bash
pnpm dev
```

## Validation

Before opening a pull request, run:

```bash
pnpm test
pnpm --filter @music-together/client typecheck
pnpm --filter @music-together/client lint
pnpm build
```

Tests use Vitest and live beside source files as `*.test.ts` or `*.test.tsx`. Default tests must mock NetEase, QQ Music, and Kugou APIs rather than relying on live services.

## Architecture

- Client: `packages/client`
- Server: `packages/server`
- Shared events, types, abilities, and schemas: `packages/shared`
- Architecture documentation: `docs/architecture`

Preserve the server's controller → service → repository separation. Keep Socket.IO events and externally validated schemas in the shared package.

## Pull Requests

Keep changes focused and include:

- a concise summary;
- regression tests for bug fixes or business-logic changes;
- commands used for verification;
- documentation updates when architecture, APIs, dependencies, deployment, or developer workflow changes.

Never commit `.env` files, cookies, tokens, passwords, generated build output, or temporary files.
