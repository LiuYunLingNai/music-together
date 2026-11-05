/**
 * 浏览器媒体元素失败分类。上游 `services/playbackRecovery/mediaFailureClassifier.ts`
 * 的忠实移植；转码分支本仓没有对应服务，仅保留分类结果。
 */

export type MediaFailureKind = 'aborted' | 'network' | 'decode' | 'unsupported' | 'unknown'

export interface MediaFailureClassification {
  kind: MediaFailureKind
  eligibleForTranscode: boolean
  code: number | null
}

const MEDIA_ERR_ABORTED = 1
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

export const classifyMediaElementFailure = (
  code: number | null | undefined,
): MediaFailureClassification => {
  const resolved = typeof code === 'number' && code > 0 ? code : null
  if (resolved === MEDIA_ERR_ABORTED) return { kind: 'aborted', eligibleForTranscode: false, code: resolved }
  if (resolved === MEDIA_ERR_NETWORK) return { kind: 'network', eligibleForTranscode: false, code: resolved }
  if (resolved === MEDIA_ERR_DECODE) return { kind: 'decode', eligibleForTranscode: true, code: resolved }
  if (resolved === MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return { kind: 'unsupported', eligibleForTranscode: true, code: resolved }
  }
  return { kind: 'unknown', eligibleForTranscode: false, code: resolved }
}

/** 值得重新向服务端解析音源再试一次的失败。 */
export const isRecoverableStreamFailure = (kind: MediaFailureKind): boolean =>
  kind === 'network' || kind === 'decode' || kind === 'unsupported'
