import { useReducedMotion } from 'motion/react'

// Background drift follows the host's system motion preference.
export const useReducedMotionFor = () => !!useReducedMotion()
