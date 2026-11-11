import { SERVER_URL } from '@/lib/config'

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(String(status))
    this.name = 'ApiError'
  }
}

export function statusOf(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined
}

/** 带凭据 GET `/api/music/<path>` 并解析 JSON；非 2xx 抛出带状态码的 ApiError。 */
export async function getMusicJson<T>(
  path: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
  const res = await fetch(`${SERVER_URL}/api/music/${path}?${query}`, { signal, credentials: 'include' })
  if (!res.ok) throw new ApiError(res.status)
  return (await res.json()) as T
}
