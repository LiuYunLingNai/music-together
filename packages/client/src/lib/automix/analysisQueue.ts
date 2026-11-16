/**
 * 重分析任务的单通道队列。
 *
 * 整曲解码与逐帧分析各占几十到上百 MB，画像预取与分轨准备在曲末会重叠，
 * 同时跑两份等同把内存峰值翻倍。一个尾随 Promise 足够：任务本来就是串行的。
 */
let tail: Promise<unknown> = Promise.resolve()

export const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const run = tail.then(task, task)
  tail = run.then(() => undefined, () => undefined)
  return run
}
