# Music Together — Agent Instructions

## Scope

These instructions apply to all work in this repository. Keep changes focused on the user's request and follow the existing architecture documented under `docs/architecture/`.

## Verification Commands

- Do not start development, preview, production servers, or run a full build unless the user explicitly asks.
- Prefer the narrowest relevant non-server check first.
- Allowed routine checks:

```bash
pnpm test
pnpm --filter @music-together/client typecheck
pnpm --filter @music-together/client lint
```

- When the user explicitly asks for build verification, run:

```bash
pnpm build
```

- The repository may contain unrelated uncommitted agent-configuration changes. Do not restore, delete, stage, or commit unrelated files.

## Frontend

- Use the existing shadcn/ui components from `packages/client/src/components/ui/` before adding custom primitives or another component library.
- Use `lucide-react` for interface icons; do not use emoji as UI icons.
- Use the installed `motion` package for React animation when animation is warranted.
- Follow mobile-first responsive design: base styles target small screens, then enhance with `sm:`, `md:`, `lg:`, and `xl:`.
- Preserve touch-friendly targets and verify important layouts conceptually at 375px, 768px, 1024px, and 1440px.
- Prefer Tailwind utility classes and the existing CSS variable theme.
- Use PascalCase for React component filenames and `useXxx` naming for hooks.
- Load the `frontend-design` and `frontend-patterns` skills for substantial UI work.

## Backend and Shared Code

- Preserve the controller → service → repository separation used by the server.
- Validate external input with schemas from `packages/shared/src/schemas.ts`.
- Keep Socket.IO event names and payload types centralized in the shared package.
- Never log cookies, tokens, platform credentials, passwords, or other secrets.
- Treat music-provider endpoints as unstable external APIs: add timeouts, validate business response codes, and test parsing with mocked or fixture responses.
- Load the `backend-patterns` skill for substantial server work.

## Tests

- Add or update Vitest regression tests for bug fixes and meaningful business-logic changes.
- Keep unit tests beside the source as `*.test.ts` or `*.test.tsx`.
- Mock external music services in the default test suite; do not make ordinary CI tests depend on live NetEase, QQ Music, or Kugou endpoints.
- Run `pnpm test` and the narrowest relevant typecheck before reporting completion; run a full build only when the user explicitly requests it.

## Documentation

Update the relevant files under `docs/architecture/` when a change affects:

- package or directory structure;
- architecture, data flow, or design patterns;
- Socket.IO events or REST endpoints;
- core shared models or schemas;
- deployment behavior;
- UI design conventions;
- core dependencies or developer workflow.

Update only the sections affected by the change. `docs/PROJECT_ARCHITECTURE.md` is the index/overview; detailed documentation belongs in its linked subdocuments.

## Git Workflow

- Use POSIX/bash syntax in all shell commands.
- Do not stage, commit, push, create a PR, or merge unless the user asks.
- When the user requests the full branch/PR workflow, load the `git-branch-pr-flow` skill.
- Never commit `.env` files, credentials, generated build output, or temporary files.
