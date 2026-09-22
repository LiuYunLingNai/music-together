import { describe, expect, it } from 'vitest'
import { resolveServerUrl, type PageLocation } from './config'

/**
 * 回归：dev 下"环回别名不一致"导致的**鉴权死循环**。
 *
 * 真实事故（用户报"进网页后台日志爆炸输出"）：
 *
 *   页面 `http://127.0.0.1:5173`，`.env.development` 配的是
 *   `VITE_SERVER_URL=http://localhost:3001`。旧判据
 *
 *     LOCALHOST_HOSTS.has(parsed.hostname) && !LOCALHOST_HOSTS.has(page.hostname)
 *
 *   两者**都是**环回别名，于是第二个条件为 false → **不改写** → API 停在
 *   `localhost:3001`，与页面 `127.0.0.1:5173` **不同站点**。
 *
 *   `mt_identity` 是 `SameSite=Lax` 且无 `Domain`（主机专属）→ 跨站点子资源
 *   请求不发送它 → 服务端 `hasCookieHeader: false` → `UNAUTHENTICATED` →
 *   客户端立刻重连 → 死循环（服务端每来回 2 行 warn）。
 *
 * 本用例钉住"配置主机与页面主机不相同就跟随页面"这一判据。
 */
const page = (hostname: string, protocol = 'http:'): PageLocation => ({
  protocol,
  hostname,
  origin: `${protocol}//${hostname}:5173`,
})

describe('resolveServerUrl：dev 主机跟随', () => {
  it('★ 页面 127.0.0.1 + 配置 localhost → 必须跟随页面（修复的死循环）', () => {
    expect(resolveServerUrl('http://localhost:3001', page('127.0.0.1'), true)).toBe('http://127.0.0.1:3001')
  })

  it('★ 页面 localhost + 配置 127.0.0.1 → 同样必须跟随页面', () => {
    expect(resolveServerUrl('http://127.0.0.1:3001', page('localhost'), true)).toBe('http://localhost:3001')
  })

  it('页面与配置主机相同 → 不改写（保持既有正确行为）', () => {
    expect(resolveServerUrl('http://localhost:3001', page('localhost'), true)).toBe('http://localhost:3001')
    expect(resolveServerUrl('http://127.0.0.1:3001', page('127.0.0.1'), true)).toBe('http://127.0.0.1:3001')
  })

  it('LAN IP 访问 → 跟随页面 IP（原本就想支持的场景）', () => {
    expect(resolveServerUrl('http://localhost:3001', page('192.168.1.50'), true)).toBe('http://192.168.1.50:3001')
  })

  it('IPv6 环回别名（[::1] 带方括号）也要能匹配并跟随', () => {
    // URL.hostname 对 IPv6 返回带方括号的 [::1]，不归一化就永远匹配不上
    expect(resolveServerUrl('http://localhost:3001', page('[::1]'), true)).toBe('http://[::1]:3001')
    expect(resolveServerUrl('http://[::1]:3001', page('localhost'), true)).toBe('http://localhost:3001')
  })

  it('★ 显式指向远程后端的配置不得被改写（只在配置是环回别名时跟随）', () => {
    expect(resolveServerUrl('https://api.example.com', page('127.0.0.1'), true)).toBe('https://api.example.com')
    expect(resolveServerUrl('https://api.example.com:8443', page('192.168.1.50'), true)).toBe(
      'https://api.example.com:8443',
    )
  })

  it('保留端口与路径，仅替换主机名', () => {
    expect(resolveServerUrl('http://localhost:3001/base/', page('127.0.0.1'), true)).toBe('http://127.0.0.1:3001/base')
    // 末尾斜杠一律去掉（与旧实现一致）
    expect(resolveServerUrl('http://localhost:3001/', page('localhost'), true)).toBe('http://localhost:3001')
  })

  it('生产环境不做任何改写', () => {
    expect(resolveServerUrl('http://localhost:3001', page('127.0.0.1'), false)).toBe('http://localhost:3001')
  })

  it('未配置时：dev 用页面主机 + 3001；生产用页面 origin', () => {
    expect(resolveServerUrl(undefined, page('127.0.0.1'), true)).toBe('http://127.0.0.1:3001')
    expect(resolveServerUrl('', page('127.0.0.1'), true)).toBe('http://127.0.0.1:3001')
    expect(resolveServerUrl(undefined, page('example.com', 'https:'), false)).toBe('https://example.com:5173')
  })

  it('畸形配置回退为原样（去尾斜杠），不抛错', () => {
    expect(resolveServerUrl('not a url', page('127.0.0.1'), true)).toBe('not a url')
    expect(resolveServerUrl('  http://localhost:3001/  ', page('localhost'), true)).toBe('http://localhost:3001')
  })
})
