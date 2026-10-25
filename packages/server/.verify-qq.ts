import fs from 'node:fs'
import { loginWithSessionCookie, getUserInfo, isRefreshableCredential } from './src/services/tencentAuthService.js'

const file = process.argv[2]
const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
const cookie: string = raw.cookieString
console.log('输入 Cookie 条目数:', Object.keys(raw.jar).length)
console.log('输入已含 refresh 字段:', isRefreshableCredential(cookie))

const credential = await loginWithSessionCookie(cookie)
if (!credential) {
  console.log('RESULT=FAILED 未能换出音乐凭证')
  process.exit(1)
}

console.log('RESULT=OK 凭证长度:', credential.length)
console.log('可自动续期:', isRefreshableCredential(credential))
console.log('凭证字段:', credential.split('; ').map((p) => p.split('=')[0]).join(', '))

const info = await getUserInfo(credential)
console.log('getUserInfo:', JSON.stringify(info))
fs.writeFileSync(process.argv[3] ?? '/tmp/qq-cred.txt', credential)
