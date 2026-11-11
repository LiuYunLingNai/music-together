/** 外部平台接口的默认超时。 */
export const API_TIMEOUT_MS = 15_000

/** `ms` 内未完成则返回 null（无法取消的 SDK 请求只是不再等待），调用方把超时当作「没有结果」。 */
export async function withTimeoutOrNull<T>(work: Promise<T>, ms = API_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
