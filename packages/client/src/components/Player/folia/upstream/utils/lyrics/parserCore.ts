import type { Line } from '../../types'

// Preserve Folia's interlude sentinel without importing its provider/parser pipeline.
export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean => line.fullText === '......'
