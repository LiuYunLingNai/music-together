import type { ClientInfo } from '@music-together/shared'

type HeaderValue = string | string[] | undefined
type ClientHeaders = Record<string, HeaderValue>

function headerValue(headers: ClientHeaders, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function detectOperatingSystem(userAgent: string, clientHintPlatform: string): string | null {
  const hint = clientHintPlatform.replaceAll('"', '').trim().toLowerCase()
  if (hint === 'windows') return 'Windows'
  if (hint === 'macos') return 'macOS'
  if (hint === 'android') return 'Android'
  if (hint === 'ios') return 'iPhone'
  if (hint === 'linux') return 'Linux'
  if (/windows phone/i.test(userAgent)) return 'Windows Phone'
  if (/windows/i.test(userAgent)) return 'Windows'
  if (/iphone|ipod/i.test(userAgent)) return 'iPhone'
  if (/ipad/i.test(userAgent)) return 'iPad'
  if (/android/i.test(userAgent)) return 'Android'
  if (/macintosh|mac os x/i.test(userAgent)) return 'macOS'
  if (/linux/i.test(userAgent)) return 'Linux'
  return null
}

function detectBrowser(userAgent: string, clientHintBrands: string): string | null {
  const brands = clientHintBrands.toLowerCase()
  if (brands.includes('microsoft edge')) return 'Edge'
  if (brands.includes('google chrome')) return 'Chrome'
  if (/edg\//i.test(userAgent)) return 'Edge'
  if (/opr\//i.test(userAgent)) return 'Opera'
  if (/firefox\//i.test(userAgent)) return 'Firefox'
  if (/crios\//i.test(userAgent)) return 'Chrome'
  if (/fxios\//i.test(userAgent)) return 'Firefox'
  if (/chrome\//i.test(userAgent)) return 'Chrome'
  if (/safari\//i.test(userAgent) && /version\//i.test(userAgent)) return 'Safari'
  return null
}

/** Infer a coarse client label; raw user agents and versions are never exposed. */
export function getClientInfo(headers: ClientHeaders): ClientInfo | undefined {
  const userAgent = headerValue(headers, 'user-agent').trim()
  if (!userAgent) return undefined
  if (/music[- ]together[- ]android/i.test(userAgent) || /^okhttp\//i.test(userAgent)) {
    return { kind: 'android', label: 'Android 客户端' }
  }
  if (/music[- ]together[- ]windows/i.test(userAgent)) {
    return { kind: 'windows', label: 'Windows 客户端' }
  }

  const operatingSystem = detectOperatingSystem(userAgent, headerValue(headers, 'sec-ch-ua-platform'))
  if (/electron\//i.test(userAgent)) {
    return {
      kind: operatingSystem === 'Windows' ? 'windows' : 'desktop',
      label: operatingSystem ? `桌面客户端 · ${operatingSystem}` : '桌面客户端',
    }
  }
  const browser = detectBrowser(userAgent, headerValue(headers, 'sec-ch-ua'))
  if (!browser) return operatingSystem ? { kind: 'web', label: `网页 · ${operatingSystem}` } : undefined
  return { kind: 'web', label: operatingSystem ? `${browser} · ${operatingSystem}` : browser }
}
