import { useReducedMotion } from 'motion/react'

/**
 * 上游 `useReducedMotionFor(surface)` 的宿主版：上游按「动效面」读自己的设置 store
 * （用户可覆盖系统偏好）；本项目没有那份设置，只剩系统偏好，`surface` 因此不参与判断。
 * 保留参数是为了让上游调用点原样保留。
 */
export const useReducedMotionFor = (surface?: string): boolean => {
  void surface
  return !!useReducedMotion()
}

export default useReducedMotionFor
