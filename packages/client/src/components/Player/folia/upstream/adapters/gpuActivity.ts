// 宿主没有 GPU 分离；町景的自动降级改为跟随本机的分析活动（混音特征 / 响度测量）。
import { isAnalysisActivity } from '@/services/beatFx/analysisActivity'

export const isGpuAnalysisActive = (now?: number): boolean => {
  void now
  return isAnalysisActivity()
}
