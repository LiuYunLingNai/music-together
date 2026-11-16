/** 进房、重连后自动补发 Cookie 的应答计数：这些应答静默处理，只有手动操作的结果才弹 toast。 */
let pending = 0

export function expectAutoResend(count: number): void {
  pending = count
}

/** 取走一个自动补发应答；返回 true 表示这条应答属于自动补发。 */
export function consumeAutoResend(): boolean {
  if (pending <= 0) return false
  pending--
  return true
}
