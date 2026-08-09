---
trigger: always_on
---

# 前端设计规范

## 组件库：shadcn/ui（强制）

所有 UI 组件**必须**优先使用 shadcn/ui，禁止引入其他组件库（如 Ant Design、MUI 等）。

- **已有组件**直接从 `@/components/ui/` 导入
- **缺失组件**使用 `npx shadcn@latest add <component>` 安装
- 项目配置：`new-york` 风格、`lucide` 图标、Tailwind CSS Variables
- 图标统一使用 `lucide-react`，**禁止使用 emoji 作为 UI 图标**

```tsx
// ✅ 正确
import { Button } from "@/components/ui/button";
import { Music } from "lucide-react";

// ❌ 错误 — 禁止引入外部组件库
import { Button } from "@mui/material";
```

## 设计工作流

开始前端开发或设计任务时，按以下顺序工作：

1. 阅读现有页面、相邻组件、`index.css` 和 [UI 设计文档](../../docs/architecture/ui-design.md)
2. 明确本次改动延续的布局、配色、字体、层级、动效和响应式行为
3. 优先复用现有 shadcn/ui、CSS 变量、组件模式和 `motion` 动画能力
4. 实现后检查键盘、焦点、触控、加载、空状态、错误状态以及减少动画设置

如果当前环境提供设计检索或前端设计 skill，可用它补充以下维度，但不能把某个未安装命令作为继续工作的前置条件：

- `--domain style` — 视觉风格（glassmorphism、minimalism 等）
- `--domain typography` — 字体配对与 Google Fonts 导入
- `--domain color` — 配色方案
- `--domain ux` — 交互最佳实践与反模式

## 响应式设计（Mobile-First）

本项目采用 **移动优先** 策略，先为移动端设计核心体验，再向桌面端渐进增强。

### Tailwind 断点使用规则

默认样式即移动端样式，通过 `sm:`/`md:`/`lg:`/`xl:` 断点向上增强：

```tsx
// ✅ 正确 — Mobile-First：默认移动端，断点向上增强
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3 lg:gap-6">

// ❌ 错误 — Desktop-First：禁止以桌面端为基准向下覆盖
<div className="grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
```

### 断点层级（从小到大增强）

| 断点  | 尺寸    | 目标设备      | 优先级   |
| ----- | ------- | ------------- | -------- |
| 默认  | <640px  | 手机          | **最高** |
| `sm:` | ≥640px  | 大手机/小平板 | 高       |
| `md:` | ≥768px  | 平板          | 中       |
| `lg:` | ≥1024px | 桌面          | 低       |
| `xl:` | ≥1280px | 桌面大屏      | 最低     |

### 适配策略

- **移动端**（默认）：单列布局、底部导航、抽屉式面板、触控友好的点击区域（≥44px）
- **平板端**（`md:`）：适当增加列数、侧边栏可折叠
- **桌面端**（`lg:`）：完整功能、多列布局、侧边栏展开、丰富的 hover 交互
- 关键布局组件必须在 `375px`、`768px`、`1024px`、`1440px` 四个宽度下验证

## 交互设计原则

### 高效简洁

- 减少用户操作步骤，核心功能 ≤ 3 次点击可达
- 表单使用合理默认值，避免不必要的必填项
- 加载状态使用 Skeleton 而非 Spinner，保持布局稳定

### 现代化体验

- 使用项目已安装的 `motion`（从 `motion/react` 导入）实现需要编排的 React 动画；简单状态优先使用 CSS transition
- 可交互元素必须有视觉反馈（hover/active/focus 状态）
- 非原生可点击容器必须同时提供正确语义、键盘操作和焦点样式；不要只添加 `cursor-pointer`
- 过渡动画时长 150–300ms，使用 `ease-out` 缓动
- 尊重 `prefers-reduced-motion`，持续背景和高成本效果在低性能设备上需要降级

### 视觉层次

- 通过字重、颜色深浅、间距建立清晰的信息层级
- 主操作按钮突出，次要操作弱化
- 善用留白，避免信息过载

## 代码规范

- 组件文件使用 PascalCase：`PlayerControls.tsx`
- 文件持续膨胀且出现可独立维护职责时拆分；不要为了满足固定行数制造无意义组件
- 样式优先使用 Tailwind 工具类，复杂样式提取为 CSS Variables
- 响应式使用 Mobile-First（`sm:`/`md:`/`lg:` 断点），禁止 Desktop-First 写法
