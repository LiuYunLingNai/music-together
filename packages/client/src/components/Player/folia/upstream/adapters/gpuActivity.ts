// 本仓没有 beat_this / htdemucs 的 GPU 分析调度，町景的自动降级把它当恒不活跃。
/* eslint-disable @typescript-eslint/no-unused-vars -- 与上游同签名：宿主没有 GPU 分析调度，参数恒不读。 */
export const isGpuAnalysisActive = (_now?: number): boolean => false
