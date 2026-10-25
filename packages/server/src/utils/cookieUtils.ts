/**
 * Cookie 字符串解析工具
 * 统一替代 kugouAuthService 和 tencentAuthService 中的重复实现
 */

/**
 * 将 cookie 字符串解析为 key-value 对象
 * @example parseCookieString('token=abc;userid=123') => { token: 'abc', userid: '123' }
 */
export function parseCookieString(cookie: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of cookie.split(';')) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx < 1) continue
    const key = pair.substring(0, eqIdx).trim()
    const value = pair.substring(eqIdx + 1).trim()
    result[key] = value
  }
  return result
}

/**
 * 从 cookie 字符串中快速提取单个 key 的值
 * 比 parseCookieString 更高效（无需解析整个字符串）
 * @example getCookieValue('uin=123456; qm_keyst=abc', 'uin') => '123456'
 */
export function getCookieValue(cookie: string, key: string): string | null {
  const regex = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`)
  const match = cookie.match(regex)
  return match ? match[1].trim() : null
}

/**
 * 归一化用户在「手动输入 Cookie」框里粘贴的内容。
 *
 * 用户常常直接粘贴浏览器 DevTools 的 **Copy as cURL** 结果，或者带 `Cookie:` 前缀，
 * 这些都不是合法的 cookie 串。这里把它们还原成纯 cookie：
 *
 *   1. cURL 命令 → 优先取 `-b/--cookie` 参数，其次取 `cookie:` 请求头
 *   2. `Cookie: xxx` 前缀 → 去掉前缀
 *   3. 其他情况原样返回（trim 后）
 *
 * 注意：cURL 里的 `HttpOnly` 等 cookie 属性名会被保留（它们只是普通 key），
 * 真正的 cookie 值在 `key=value` 形式里，不受影响。
 */
export function normalizeCookieInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  // 识别 cURL 命令：包含 curl 可执行文件或 -H/--header/-b/--cookie 参数
  const looksLikeCurl = /(^|\s)curl(\.exe)?(\s|$)/i.test(trimmed) || /(^|\s)(-H|--header|-b|--cookie)(\s|=)/i.test(trimmed)

  if (looksLikeCurl) {
    // 优先 -b / --cookie：它就是完整的 cookie 串
    const cookieArg = trimmed.match(/(?:^|\s)(?:-b|--cookie)\s+["']([^"']+)["']/i)
    if (cookieArg?.[1]) return cookieArg[1].trim()

    const cookieArgUnquoted = trimmed.match(/(?:^|\s)(?:-b|--cookie)\s+(\S+)/i)
    if (cookieArgUnquoted?.[1] && cookieArgUnquoted[1].includes('=')) {
      return cookieArgUnquoted[1].trim()
    }

    // 其次找 cookie 请求头（-H 'cookie: xxx' / --header "cookie: xxx"）
    const header = trimmed.match(/(?:^|\s)(?:-H|--header)\s+["'][^"']*\bcookie\s*:\s*([^"']+)["']/i)
    if (header?.[1]) return header[1].trim()

    const headerUnquoted = trimmed.match(/(?:^|\s)(?:-H|--header)\s+(\S*\bcookie\s*:\s*\S+)/i)
    if (headerUnquoted?.[1]) return headerUnquoted[1].replace(/^["']|["']$/g, '').trim()
  }

  // 去掉 `Cookie:` 前缀
  const labeled = trimmed.match(/^cookie\s*:\s*(.+)$/i)
  if (labeled?.[1]) return labeled[1].trim()

  return trimmed
}
