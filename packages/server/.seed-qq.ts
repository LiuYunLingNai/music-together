import fs from 'node:fs'
import { platformAuthRepo } from './src/repositories/platformAuthRepository.js'
import { getUserInfo } from './src/services/tencentAuthService.js'

const credFile = process.argv[2]
const credential = fs.readFileSync(credFile, 'utf8').trim()

const info = await getUserInfo(credential)
if (!info.ok) {
  console.log('FAILED 凭证校验不通过:', JSON.stringify(info))
  process.exit(1)
}

const users = process.argv.slice(3)
console.log('目标用户:', users.join(', '))
console.log('账号:', info.data.nickname, '| VIP:', info.data.vipType)

for (const userId of users) {
  platformAuthRepo.save(
    {
      userId,
      platform: 'tencent',
      cookie: credential,
      nickname: info.data.nickname,
      vipType: info.data.vipType,
      avatarUrl: info.data.avatarUrl,
    },
    { resetCredentialRefreshSchedule: true },
  )
  console.log('已写入 platform_auth:', userId)
}

const summaries = users.map((u) => ({ user: u, tencent: platformAuthRepo.loadSummaries(u).map((s) => `${s.platform}:${s.nickname}`) }))
console.log('回读校验:', JSON.stringify(summaries))
