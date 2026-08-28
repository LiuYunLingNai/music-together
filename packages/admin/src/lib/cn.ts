/** 轻量 className 拼接（不引入额外依赖） */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
