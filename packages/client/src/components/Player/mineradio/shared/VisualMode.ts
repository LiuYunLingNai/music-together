/**
 * 兼容 shim：`VisualMode` 已迁至 `stages/VisualMode.ts`（两族舞台共用的中立层）。
 *
 * mineradio 是它的**消费者**而不是所有者 —— folia 舞台与 `stages/registry.ts`
 * 也读这份注册表。新代码请直接 import `stages/VisualMode`；本文件只保留
 * mineradio 内部既有相对路径引用不断链，待引用全部迁移后删除。
 */
export * from '../../stages/VisualMode'
