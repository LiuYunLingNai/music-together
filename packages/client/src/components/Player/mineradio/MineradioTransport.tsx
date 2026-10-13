/**
 * 兼容 shim：共享播放控制条已迁至 `stages/Transport.tsx`（两族舞台共用的中立层）。
 *
 * 它不再属于 mineradio 一族 —— folia 的 `FoliaControlBar` 同样以它为底座。
 * 新代码请直接 import `stages/Transport`；本文件只保持既有引用不断链。
 */
export { Transport } from '../stages/Transport'
export type { TransportProps } from '../stages/Transport'
