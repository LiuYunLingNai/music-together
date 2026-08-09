---
trigger: always_on
---

# 禁止执行开发/构建命令

**严格禁止**自行执行以下命令（包括但不限于）：

- `pnpm dev` / `pnpm run dev`
- `pnpm build` / `pnpm run build`
- `pnpm start` / `pnpm run start`
- `pnpm preview` / `pnpm run preview`
- 以及任何等效的 `npm run …` / `yarn …` 变体

## 正确做法

当需要启动开发服务器或执行构建时，**告诉用户需要运行的命令**，由用户自行在终端中执行。

```
// ✅ 正确 — 提示用户执行
"请在终端中运行 `pnpm dev` 启动开发服务器。"

// ❌ 错误 — 自行执行
Shell: pnpm dev
```

## 允许的操作

以下命令**可以**正常执行，不受此规则限制：

- `pnpm install` / `pnpm add <pkg>` — 仅在任务明确需要变更依赖时安装依赖
- `pnpm exec …` — 执行与当前任务相关的静态工具；涉及迁移、生成或外部写入时仍需先确认影响
- `pnpm run lint` / `pnpm run typecheck` — 代码检查
- `pnpm --filter @music-together/server test` — 服务端测试
- `git diff --check` — 空白与补丁检查
- `npx shadcn@latest add …` — 添加 shadcn 组件

允许执行检查不代表必须运行全部命令。应按改动风险选择最小充分验证，并在交付时说明未执行的构建或运行验证。
