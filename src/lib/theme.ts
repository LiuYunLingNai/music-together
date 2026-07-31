export type ThemePreference = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'auto' ? systemTheme() : preference
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
