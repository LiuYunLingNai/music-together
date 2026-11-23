import type { ListeningEnvironment } from '@music-together/shared'

export function listeningEnvironment(): ListeningEnvironment {
  const browserNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string }
    connection?: { type?: string }
  }
  const clean = (value: unknown, fallback: string) =>
    String(value ?? '')
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0)
        return code >= 32 && code !== 127
      })
      .join('')
      .trim()
      .slice(0, 80) || fallback
  return {
    model: 'MusicTogetherWeb',
    os: clean(browserNavigator.userAgentData?.platform || navigator.platform, 'Web'),
    width: Math.max(1, Math.round(screen.width || window.innerWidth)),
    height: Math.max(1, Math.round(screen.height || window.innerHeight)),
    network: clean(browserNavigator.connection?.type, 'unknown').slice(0, 32),
  }
}
