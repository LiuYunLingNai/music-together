/** 竖屏歌词页与歌曲信息栏之间的文字共享元素形变。 */
export const SONG_INFO_TRANSITION = {
  layout: { type: 'tween' as const, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
}
