---
trigger: always_on
---

# 开发/构建命令授权规则

默认不得自行执行以下命令（包括但不限于）：

- `pnpm dev` / `pnpm run dev`
- `pnpm build` / `pnpm run build`
- `pnpm start` / `pnpm run start`
- `pnpm preview` / `pnpm run preview`
- 以及任何等效的 `npm run …` / `yarn …` 变体

## 授权边界

当用户只是咨询、审查或未明确要求构建/部署时，应告诉用户需要运行的命令，由用户自行执行。

当用户在当前任务中**明确要求或授权**编译、构建、部署、启动或安装时，可以执行完成该目标所需的对应命令，但必须：

- 只在用户指定的仓库、分支、设备或服务器范围内执行
- 部署前确认目标、数据目录和回滚方式，避免覆盖用户数据
- 不把一次授权扩展为以后任务的长期授权
- 完成后说明实际执行的命令类别、验证结果和未覆盖的风险

```
// ✅ 未获授权 — 提示用户执行
"请在终端中运行 `pnpm dev` 启动开发服务器。"

// ✅ 用户明确要求“构建并部署” — 可在确认目标和回滚方案后执行
Shell: pnpm build

// ❌ 错误 — 用户只要求审查代码时擅自启动服务
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
