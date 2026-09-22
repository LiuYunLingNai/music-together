/**
 * 环回主机别名。
 *
 * ⚠️ 注意 `URL.hostname` 对 IPv6 返回**带方括号**的 `[::1]`，而浏览器
 * `location.hostname` 同样返回 `[::1]` —— 因此比较前统一用
 * `normalizeHostname()` 去掉方括号，否则这里的 `'::1'` 永远匹配不上。
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

/** 归一化主机名：去掉 IPv6 方括号 + 小写（主机名大小写不敏感）。 */
function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** 页面位置中解析后端地址所需的字段（`Location` 结构兼容）。 */
export interface PageLocation {
  protocol: string
  hostname: string
  origin: string
}

/**
 * 解析后端地址（纯函数，便于测试）。
 *
 * 开发环境（Vite :5173 / 后端 :3001）下，若 `.env.development` 里配置的是
 * **环回别名**，则改写成**页面实际使用的主机名** —— 这样用 `localhost`、
 * `127.0.0.1` 或局域网 IP 访问时，API 都指向同一个主机，从而与页面同站点。
 *
 * ============================ 为什么判据必须是"不相同" ============================
 *
 * ★ 曾经的判据是"配置主机是环回别名 **且页面主机不是**环回别名"：
 *
 *     LOCALHOST_HOSTS.has(parsed.hostname) && !LOCALHOST_HOSTS.has(page.hostname)
 *
 *   它想表达"用 LAN IP 访问时跟随页面主机"，但漏掉了
 *   **「页面 `127.0.0.1`、配置 `localhost`」**这一组合 —— 两者**都是**环回别名，
 *   却不是同一个主机名，于是改写不发生：API 停在 `localhost:3001`，而页面在
 *   `127.0.0.1:5173`。
 *
 *   后果是**鉴权死循环**：`mt_identity` cookie 是 `SameSite=Lax` 且**没有
 *   `Domain` 属性**（主机专属），`localhost` 与 `127.0.0.1` 在浏览器看来是
 *   **两个不同站点** → 跨站点子资源请求不发送该 cookie → 服务端
 *   `hasCookieHeader: false` → `UNAUTHENTICATED` → 客户端立刻重连 → 循环，
 *   服务端每个来回打 2 行 warn，日志刷屏。
 *
 *   现在的判据"配置主机与页面主机**不相同**"同时覆盖了三种情形：
 *     · 页面 `127.0.0.1` + 配置 `localhost` → 改写为 `127.0.0.1`（修好的那条）
 *     · 页面 `192.168.x.x` + 配置 `localhost` → 改写为该 IP（LAN 行为不变）
 *     · 页面 `localhost` + 配置 `localhost` → 相同，不改写（行为不变）
 *
 * ★ **只在配置本身是环回别名时改写** —— 显式指向远程服务器的配置必须原样保留，
 *   否则会把"开发机连远程后端"这种有意配置改坏。
 */
export function resolveServerUrl(configuredUrl: string | undefined, page: PageLocation, isDev: boolean): string {
  const trimmed = configuredUrl?.trim()

  if (trimmed) {
    try {
      const parsed = new URL(trimmed)
      const pageHost = normalizeHostname(page.hostname)
      const configHost = normalizeHostname(parsed.hostname)
      if (isDev && LOOPBACK_HOSTNAMES.has(configHost) && configHost !== pageHost) {
        parsed.hostname = page.hostname
      }
      return trimTrailingSlash(parsed.toString())
    } catch {
      return trimTrailingSlash(trimmed)
    }
  }

  if (isDev) {
    return `${page.protocol}//${page.hostname}:3001`
  }

  return page.origin
}

/**
 * 模块级求值需要 `window`；单测在 node 环境（无 `window`）下 import 本模块时
 * 回退到一个安全的占位位置 —— 测试断言的是纯函数 `resolveServerUrl`，
 * 不依赖这个常量。
 */
const PAGE_LOCATION: PageLocation =
  typeof window === 'undefined'
    ? { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' }
    : window.location

export const SERVER_URL = resolveServerUrl(import.meta.env.VITE_SERVER_URL, PAGE_LOCATION, import.meta.env.DEV)
