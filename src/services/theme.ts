import type { ThemePreference } from '../lib/theme'
import { applyTheme, resolveTheme } from '../lib/theme'
import { storage } from '../lib/storage'
import { useAppStore } from '../store/app-store'

interface ViewTransitionLike {
  ready: Promise<void>
  finished: Promise<void>
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike
}

function commitTheme(preference: ThemePreference): void {
  const resolvedTheme = resolveTheme(preference)
  storage.setThemePreference(preference)
  applyTheme(resolvedTheme)
  useAppStore.getState().set({ themePreference: preference, resolvedTheme })
  void window.desktop?.setThemeSource(preference === 'auto' ? 'system' : preference)
}

export function initializeTheme(): void {
  const { themePreference, resolvedTheme } = useAppStore.getState()
  applyTheme(resolvedTheme)
  applyUiScale(useAppStore.getState().uiScale)
  void window.desktop?.setThemeSource(themePreference === 'auto' ? 'system' : themePreference)
}

export function setUiScale(value: number): void {
  const uiScale = Math.min(1.4, Math.max(0.9, Math.round(value * 100) / 100))
  storage.setUiScale(uiScale)
  applyUiScale(uiScale)
  useAppStore.getState().set({ uiScale })
}

function applyUiScale(value: number): void {
  document.documentElement.style.setProperty('--ui-font-scale', String(value))
}

export function syncSystemTheme(): void {
  const state = useAppStore.getState()
  if (state.themePreference !== 'auto') return
  const resolvedTheme = resolveTheme('auto')
  applyTheme(resolvedTheme)
  state.set({ resolvedTheme })
}

export async function setThemePreference(preference: ThemePreference, x?: number, y?: number): Promise<void> {
  const state = useAppStore.getState()
  const nextTheme = resolveTheme(preference)
  if (state.resolvedTheme === nextTheme) {
    commitTheme(preference)
    return
  }

  const transitionDocument = document as TransitionDocument
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!transitionDocument.startViewTransition || reducedMotion || x === undefined || y === undefined) {
    commitTheme(preference)
    return
  }

  try {
    const transition = transitionDocument.startViewTransition(() => commitTheme(preference))
    await transition.ready
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const animation = document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.2,.72,.2,1)', pseudoElement: '::view-transition-new(root)' },
    )
    await Promise.allSettled([animation.finished, transition.finished])
  } catch {
    commitTheme(preference)
  }
}
