import { HTDEMUCS_SEGMENT } from './htdemucsWgsl/runtime'
import { separateHtdemucsSegment } from './htdemucsModel'

/**
 * 整首曲目的 htdemucs 分轨（鼓 / 人声），与上游 `stemRange.ts` + `stemPass.ts` 的
 * 网格、三角窗、逐步归一化一致：
 *
 *   · 段长 172032 样本（3.9 s @44.1k），步进 3/4 段；
 *   · 每一段叠加后，把它与下一段起点之间的样本除以窗口权重（最多两段）；
 *   · 输出取 (L+R)/2 单声道，与上游 `layInto` 相同。
 */

export const STEM_SAMPLE_RATE = 44100

export interface StemTracks {
  drums: Float32Array
  vocals: Float32Array
}

const STRIDE = HTDEMUCS_SEGMENT - Math.floor(HTDEMUCS_SEGMENT / 4)

export const stemSegmentStarts = (total: number): number[] => {
  const count = Math.max(1, Math.ceil(total / STRIDE))
  const starts: number[] = []
  for (let index = 0; index < count; index += 1) {
    const start = index * STRIDE
    if (start >= total && index > 0) break
    starts.push(start)
  }
  return starts
}

export const stemSegmentWindow = (): Float32Array => {
  const overlap = Math.floor(HTDEMUCS_SEGMENT / 4)
  const win = new Float32Array(HTDEMUCS_SEGMENT).fill(1)
  for (let index = 0; index < overlap; index += 1) {
    const ramp = index / (overlap - 1)
    win[index] = ramp
    win[HTDEMUCS_SEGMENT - 1 - index] = ramp
  }
  return win
}

const weightAt = (at: number, index: number, starts: number[], win: Float32Array): number => {
  const before = index > 0 && at < starts[index - 1] + HTDEMUCS_SEGMENT ? win[at - starts[index - 1]] : 0
  return Math.max(Math.fround(before + win[at - starts[index]]), 1e-8)
}

/** 44.1 kHz 立体声 → 单声道鼓轨与人声轨；`isCurrent` 为 false 时中止并返回 null。 */
export const separateWholeTrack = async (
  left: Float32Array,
  right: Float32Array,
  isCurrent: () => boolean,
): Promise<StemTracks | null> => {
  const total = left.length
  if (!total) return null
  const win = stemSegmentWindow()
  const starts = stemSegmentStarts(total)
  const drums = new Float32Array(total)
  const vocals = new Float32Array(total)
  const inLeft = new Float32Array(HTDEMUCS_SEGMENT)
  const inRight = new Float32Array(HTDEMUCS_SEGMENT)
  let divided = 0

  for (let index = 0; index < starts.length; index += 1) {
    if (!isCurrent()) return null
    const start = starts[index]
    const n = Math.min(HTDEMUCS_SEGMENT, total - start)
    inLeft.fill(0)
    inRight.fill(0)
    inLeft.set(left.subarray(start, start + n))
    inRight.set(right.subarray(start, start + n))
    const stems = await separateHtdemucsSegment(inLeft, inRight)
    const drumStem = stems[0]
    const vocalStem = stems[1]
    if (!drumStem || !vocalStem) return null

    for (let offset = 0; offset < n; offset += 1) {
      const at = start + offset
      const w = win[offset]
      drums[at] += ((drumStem.left[offset] + drumStem.right[offset]) / 2) * w
      vocals[at] += ((vocalStem.left[offset] + vocalStem.right[offset]) / 2) * w
    }

    // 到下一段起点之前，不会再有别的段加进来：现在归一化。
    const final = index + 1 < starts.length ? starts[index + 1] : total
    for (let at = Math.max(divided, start); at < final; at += 1) {
      const divisor = weightAt(at, index, starts, win)
      drums[at] /= divisor
      vocals[at] /= divisor
    }
    divided = Math.max(divided, final)
    // 每段之间让出一次主线程：单次提交远快于逐 stage 同步（见 worker 说明），
    // 这里补回可视化线程的调度机会。
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  }
  return { drums, vocals }
}
