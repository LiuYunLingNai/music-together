/**
 * 过渡规划只关心歌词行的起止与“间奏占位”判定；完整歌词类型在客户端。
 * 服务端规划时传 `lines: null`，这里只为让上游 `transitionPlanner` 原样编译。
 */
export interface LyricWord {
  startTime: number
  endTime: number
}

export interface Line {
  startTime: number
  endTime: number
  fullText: string
  words: LyricWord[]
}

export const INTERLUDE_FULL_TEXT = '......'

export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean =>
  line.fullText === INTERLUDE_FULL_TEXT
