---
trigger: always_on
---

# 架构文档同步更新规则

`docs/PROJECT_ARCHITECTURE.md` 是架构入口和子文档索引，详细内容位于 `docs/architecture/`。
当代码变更涉及以下任何一项时，**必须**更新与改动直接相关的文档；只有入口摘要、核心能力或索引变化时才修改顶层文档。

## 触发条件

1. **项目架构变更**：新增/删除/重命名目录、调整分层结构、修改数据流
2. **设计模式变更**：引入新模式、修改现有模式（如 Store 模式、Hook 组合模式、中间件链等）
3. **UI 设计规范变更**：颜色系统、字体、圆角、动画、组件库配置等
4. **技术栈变更**：新增/移除/升级核心依赖
5. **API 变更**：新增/修改 Socket 事件、REST 端点
6. **数据模型变更**：核心类型定义（Track、RoomState、PlayState 等）的增删改
7. **新增关键组件/Hook/Store/Service/Repository**：改变目录职责或主要调用链时补充说明
8. **安全或兼容边界变化**：身份、Cookie、权限、代理、旧客户端回退或跨端协议约束变化
9. **构建与发布变化**：环境要求、脚本、Docker、CI、数据迁移或发布产物变化

## 更新要求

- 先选择负责该主题的文档，不要把全部细节堆入顶层索引：
  - 目录和职责：`architecture/directory-structure.md`
  - 数据流、事件、模型和同步：`architecture/data-flow.md`
  - 依赖：`architecture/dependencies.md`
  - 模式和模块边界：`architecture/design-patterns.md`
  - 代码约定：`architecture/coding-standards.md`
  - UI：`architecture/ui-design.md`
  - 开发与验证：`architecture/dev-guide.md`
  - 部署、环境变量和数据目录：`architecture/deployment.md`
- 只更新与本次变更相关的章节，不顺手重写无关文档
- 保持文档现有的格式和风格
- 只有新增或移动关键入口和模块时才更新目录树；普通叶子组件无需逐个登记
- 依赖变化只记录会改变架构、运行时或开发方式的依赖，不机械复制 lockfile
- 协议文档必须与 `packages/shared`、当前 `/ws` JSON 信封和实际 REST 路由一致，不写成 Socket.IO
- 持久化文档必须区分运行时内存状态与 SQLite 永久数据
- 完成代码变更后，在同一次操作中完成文档更新
