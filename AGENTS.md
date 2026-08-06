# Repository Guidelines

## 项目结构与模块组织

本项目是基于 Electron、React 19、TypeScript 和 Vite 的 Music Together 桌面客户端。`electron/` 包含主进程与 `contextBridge` 预加载层；`src/` 是渲染进程，其中 `components/` 放界面组件，`services/` 负责 API、WebSocket、播放及运行时编排，`domain/` 保存领域类型与规则，`lyrics/` 处理歌词解析和时间轴，`store/` 管理 Zustand 状态。测试以 `*.test.ts` 与被测文件同目录存放。`scripts/` 提供构建及 smoke 测试，`build/` 存放应用图标，架构说明见 `docs/ARCHITECTURE.md`。生成目录 `dist/`、`dist-electron/`、`release/` 不应提交。

## 构建、测试与开发命令

要求 Node.js 22 或更高版本。首次安装使用 `npm ci`（更新依赖时使用 `npm install`）。

- `npm run dev`：构建 Electron 主进程，并启动 Vite、TypeScript 监听和桌面应用。
- `npm run typecheck`：检查渲染进程与 Electron 代码的类型。
- `npm test` / `npm run test:watch`：单次运行或监听 Vitest 测试。
- `npm run lint`：对仓库执行 ESLint。
- `npm run build`：生成生产版渲染进程和主进程产物。
- `npm run smoke:regressions`：执行回归 smoke 测试；`smoke:online` 和 `smoke:electron` 需要可访问的服务端或已启动的 Electron 调试实例。
- `npm run dist:win`：生成带调试能力的 Windows 测试包；正式包使用 `npm run dist:win:release`。

## 编码风格与命名

遵循现有风格：两空格缩进、单引号、无分号、尾随逗号，并保持 TypeScript `strict` 通过。React 组件和类型使用 `PascalCase`，函数与变量使用 `camelCase`，普通模块文件使用 `kebab-case.ts`，组件文件使用 `PascalCase.tsx`。优先保持领域逻辑纯函数化；渲染进程不得绕过预加载桥直接使用 Node API。提交前运行 `npm run lint` 和 `npm run typecheck`。

## 测试规范

测试框架为 Vitest，环境为 `jsdom`。新增或修复领域规则、歌词解析、存储、API 与实时连接行为时，应补充相邻的 `*.test.ts`。测试名称应描述可观察行为，并隔离网络、全局对象与 Electron 桥；在 `afterEach` 中恢复 mock。仓库未设硬性覆盖率门槛，但变更路径和关键失败分支均应被验证。

## 提交与 Pull Request

历史提交采用 Conventional Commits，例如 `feat: add update notes`、`fix: recognize installer assets`、`chore: release Windows client`。保持一次提交只处理一个主题，使用简短英文祈使句；常用类型包括 `feat`、`fix`、`test`、`docs`、`chore`、`ci`。PR 应说明动机、行为变化和验证命令，关联相关 Issue；界面变更附截图或录屏，发布流程变更注明产物与版本影响。提交前至少确保 `npm run typecheck`、`npm test`、`npm run lint` 和 `npm run build` 通过。
