/**
 * QQ 音乐「本地登录助手」
 *
 * 用途：服务端部署在 NAS / 云服务器、QQ 客户端在另一台 Windows 电脑上时，
 * 由本机进程直接向同机 QQ 客户端取票，换出**可自动续期**的 QQ 音乐凭证，
 * 再把凭证粘贴到网页的「导入 QQ 登录态」里。一次即可，之后所有设备
 * （含手机）都直接点已保存账号的头像登录。
 *
 * 为什么必须在本机跑：
 *   整条链路依赖 `localhost.ptlogin2.qq.com:4301`（本机 QQ 客户端）以及它下发的
 *   `clientkey`（domain=ptlogin2.qq.com）。网页 JS 读不到这个 cookie，因此浏览器
 *   无法独立完成；只有跑在「装了 QQ 的那台机器」上的进程才行 —— QQ 音乐客户端
 *   自己也是这么做的（登录框就是内嵌的 qmbrowser）。
 *
 * 用法：
 *   pnpm --filter @music-together/server qq-login
 *   pnpm --filter @music-together/server qq-login -- --uin=3445487890
 *   pnpm --filter @music-together/server qq-login -- --json
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { listLocalAccounts, loginWithLocalAccount } from '../services/localQqLoginService.js'

interface Options {
  uin?: string
  json: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = { json: false }
  for (const arg of argv) {
    if (arg.startsWith('--uin=')) options.uin = arg.slice('--uin='.length).trim()
    else if (arg === '--json') options.json = true
  }
  return options
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))

  if (process.platform !== 'win32') {
    console.error('✖ 本机一键登录只支持 Windows（QQ NT 客户端仅在该平台提供本机登录服务）')
    return 1
  }

  const probe = await listLocalAccounts()
  if (!probe.available) {
    console.error(`✖ ${probe.message ?? '未检测到本机已登录的 QQ 客户端'}`)
    console.error('  请确认：QQ 客户端已启动并处于登录状态，然后重试。')
    return 1
  }

  let uin = options.uin
  if (!uin) {
    if (probe.accounts.length === 1) {
      uin = probe.accounts[0]!.uin
    } else if (!stdin.isTTY) {
      // 非交互环境（管道、CI）不阻塞等待输入，直接列出账号让人用 --uin 指定
      console.error('检测到多个已登录的 QQ 账号，请用 --uin 指定要登录的那个：')
      probe.accounts.forEach((acc) => console.error(`  --uin=${acc.uin}   ${acc.nickname}`))
      return 1
    } else {
      console.log('检测到多个已登录的 QQ 账号：')
      probe.accounts.forEach((acc, i) => console.log(`  ${i + 1}) ${acc.nickname}（${acc.uin}）`))
      const rl = createInterface({ input: stdin, output: stdout })
      const answer = (await rl.question('请输入要登录的序号：')).trim()
      rl.close()
      const index = Number.parseInt(answer, 10) - 1
      const picked = probe.accounts[index]
      if (!picked) {
        console.error('✖ 序号无效')
        return 1
      }
      uin = picked.uin
    }
  }

  const account = probe.accounts.find((acc) => acc.uin === uin)
  if (!account) {
    console.error(`✖ 本机 QQ 客户端里没有 uin=${uin} 的已登录账号`)
    return 1
  }

  console.error(`… 正在用本机 QQ「${account.nickname}」换取 QQ 音乐凭证`)
  const credential = await loginWithLocalAccount(account.uin)
  if (!credential) {
    console.error('✖ 换取失败。可能是 QQ 客户端未登录、票据被风控，或网络异常。')
    return 1
  }

  const refreshable = /refresh_token|refresh_key/.test(credential)

  if (options.json) {
    console.log(JSON.stringify({ uin: account.uin, nickname: account.nickname, refreshable, cookie: credential }))
    return 0
  }

  console.log('')
  console.log('✔ 已取得 QQ 音乐凭证' + (refreshable ? '（支持自动续期）' : '（不可续期，需尽快使用）'))
  console.log(`  账号：${account.nickname}（${account.uin}）`)
  console.log('')
  console.log('把下面整行复制，粘贴到网页的「导入 QQ 登录态」里：')
  console.log('')
  console.log(credential)
  console.log('')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('✖ 未预期的错误：', err)
    process.exit(1)
  })
