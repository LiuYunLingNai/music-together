import { forwardRef, type ReactNode } from 'react'
import type { Theme, AudioBands } from '../../types'
import type { MotionValue } from 'motion/react'
import type { VisualizerSharedProps } from './definition'
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../utils/fontStacks'

// Host adaptation: backgrounds and room chrome are composed once in FoliaPlayerStage.
interface ShellProps {
  theme: Theme
  audioPower: MotionValue<number>
  audioBands: AudioBands
  sharedProps?: Partial<VisualizerSharedProps>
  visualizerOpacity?: number
  renderBackground?: boolean
  children: ReactNode
  className?: string
}
const VisualizerShell = forwardRef<HTMLDivElement, ShellProps>(function VisualizerShell({ theme, children, className = '', visualizerOpacity = 1 }, ref) {
  return <div ref={ref} className={`relative h-full w-full overflow-hidden ${className}`} style={{ fontFamily: resolveThemeFontStack(theme), fontWeight: resolveThemeFontWeight(theme, 400), opacity: visualizerOpacity }}>{children}</div>
})
export default VisualizerShell
