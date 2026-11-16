/**
 * 分析活动信号。
 *
 * 宿主没有 GPU 分离，但可选的混音特征 / 响度测量仍会在主线程分片运行。
 * 町景的自动降级原本读上游的 GPU 分析活动，这里改成读本信号，分析期间
 * 临时降低渲染开销。
 */

let active = 0

export const beginAnalysisActivity = (): void => {
  active += 1
}

export const endAnalysisActivity = (): void => {
  active = Math.max(0, active - 1)
}

export const isAnalysisActivity = (): boolean => active > 0
