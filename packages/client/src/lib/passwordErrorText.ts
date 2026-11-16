import { PASSWORD_LOCKED_MESSAGE } from '@music-together/shared'

export function passwordErrorText(serverMessage: string): string {
  return serverMessage === PASSWORD_LOCKED_MESSAGE ? PASSWORD_LOCKED_MESSAGE : '密码错误，请重试'
}
