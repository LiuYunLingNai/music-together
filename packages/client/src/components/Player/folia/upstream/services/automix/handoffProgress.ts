// 上游 `src/services/automix/handoffProgress.ts`。数学部分在宿主 `lib/automix/handoffCurve`，
// 经典舞台的换歌圆环与 folia 共用同一条曲线。
export { mapTrackHandoffProgress, progressSince } from '@/lib/automix/handoffCurve'
