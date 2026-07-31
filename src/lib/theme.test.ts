import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, resolveTheme, systemTheme } from './theme'

describe('theme resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })

  it('uses the system color scheme only in auto mode', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: query.includes('prefers-color-scheme: dark') })))
    expect(systemTheme()).toBe('dark')
    expect(resolveTheme('auto')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('applies the resolved theme to the document root', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
