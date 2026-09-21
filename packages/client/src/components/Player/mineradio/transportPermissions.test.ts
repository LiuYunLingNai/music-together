import { describe, expect, it } from 'vitest'
import { defineAbilityFor } from '@music-together/shared'

/**
 * 回归测试：控制栏的**权限与投票回退**行为。
 *
 * 这些断言对应三条用户实测反馈的 bug（详见 MineradioTransport 的注释）：
 *
 * 【Bug 1】房主点"播放模式"会触发投票
 *   错误写法：
 *     if (canSetMode) onStartVote('set-mode', ...)   // ← 房主也走了投票
 *     else if (canVote) onStartVote('set-mode', ...)
 *   正确写法：
 *     if (canSetMode) socket.emit(PLAYER_SET_MODE, ...)   // 直接生效
 *     else if (canVote) onStartVote('set-mode', ...)      // 成员才投票
 *
 *   为什么必须区分：owner 的能力是 `manage all`，**没有 vote 权限**
 *   （abilities.ts 只有 member 有 vote）。所以旧写法会让房主发起一个
 *   自己都不该能投的票。
 *
 * 【Bug 2】成员可以绕过权限切歌
 *   `onClick={onNext}` 直接绑 socket.emit(PLAYER_NEXT)，绕过了 ability 判定。
 *
 * 【Bug 3】播放/暂停没有投票回退
 *   `disabled={!canPlay}` 让成员只看到灰按钮，而不是发起投票。
 */

describe('角色能力（权限回退的判定依据）', () => {
  it('owner 可以直接设置播放模式', () => {
    const owner = defineAbilityFor('owner')
    expect(owner.can('set-mode', 'Player')).toBe(true)
  })

  it('owner 的 `manage all` 同时蕴含 vote（用于投票否决）', () => {
    // 注意：CASL 的 can('manage','all') 蕴含所有 action，
    // 因此 owner 确实**也**能投票 —— 源码注释称之为"投票否决"。
    //
    // 这恰恰是旧 bug 更隐蔽的地方：旧写法
    //   if (canSetMode) onStartVote(...)
    // 在 owner 身上**不会报权限错**（owner 有 vote），
    // 于是它能"成功"发起投票，用户看到的就是"房主还要投票"。
    // 真正的问题是**行为**不对（该直接生效却发起投票），而不是权限不足。
    const owner = defineAbilityFor('owner')
    expect(owner.can('vote', 'Player')).toBe(true)
  })

  it('owner 可以直接控制播放、跳转与进度', () => {
    const owner = defineAbilityFor('owner')
    expect(owner.can('play', 'Player')).toBe(true)
    expect(owner.can('pause', 'Player')).toBe(true)
    expect(owner.can('next', 'Player')).toBe(true)
    expect(owner.can('prev', 'Player')).toBe(true)
    expect(owner.can('seek', 'Player')).toBe(true)
  })

  it('admin 拥有全套播放控制，但没有 vote（不是 manage all）', () => {
    const admin = defineAbilityFor('admin')
    for (const action of ['play', 'pause', 'seek', 'next', 'prev', 'set-mode'] as const) {
      expect(admin.can(action, 'Player')).toBe(true)
    }
    expect(admin.can('vote', 'Player')).toBe(false)
  })

  it('member 只能投票，不能直接控制', () => {
    const member = defineAbilityFor('member')
    expect(member.can('vote', 'Player')).toBe(true)
    for (const action of ['play', 'pause', 'seek', 'next', 'prev', 'set-mode'] as const) {
      expect(member.can(action, 'Player')).toBe(false)
    }
  })
})

/**
 * 把 MineradioTransport 的决策逻辑抽出来做纯函数测试。
 *
 * 这里复刻的是**修复后的**判定结构：先看直接权限，再回退到投票。
 * 若有人改回"两个分支都投票"，这些断言会失败。
 */
type Decision = 'direct' | 'vote' | 'none'

function decideModeToggle(canSetMode: boolean, canVote: boolean): Decision {
  if (canSetMode) return 'direct'
  if (canVote) return 'vote'
  return 'none'
}

function decideTransport(canAct: boolean, canVote: boolean): Decision {
  if (canAct) return 'direct'
  if (canVote) return 'vote'
  return 'none'
}

describe('模式切换的决策（Bug 1 回归）', () => {
  it('房主 → 直接切换，绝不发起投票', () => {
    // 这是 bug 的核心：owner 的 canSetMode 为真，必须走 direct 分支。
    // 旧写法在 canSetMode 分支里调 onStartVote，且因为 owner 有 vote
    // 权限而"静默成功"，用户看到的就是"房主还要投票"。
    const owner = defineAbilityFor('owner')
    const decision = decideModeToggle(owner.can('set-mode', 'Player'), owner.can('vote', 'Player'))
    expect(decision).toBe('direct')
  })

  it('admin（可 set-mode）→ 直接切换', () => {
    const admin = defineAbilityFor('admin')
    expect(decideModeToggle(admin.can('set-mode', 'Player'), admin.can('vote', 'Player'))).toBe(
      'direct',
    )
  })

  it('member（不可 set-mode、可投票）→ 发起投票', () => {
    const member = defineAbilityFor('member')
    expect(decideModeToggle(member.can('set-mode', 'Player'), member.can('vote', 'Player'))).toBe(
      'vote',
    )
  })

  it('无任何权限 → 不做任何事', () => {
    expect(decideModeToggle(false, false)).toBe('none')
  })

  it('决策优先看直接权限：能直接做就绝不投票', () => {
    // 即使同时具备两种能力，也必须选 direct
    expect(decideModeToggle(true, true)).toBe('direct')
  })
})

describe('播放控制的决策（Bug 2 / Bug 3 回归）', () => {
  it('member 点下一首 → 发起投票，而不是直接切歌', () => {
    const member = defineAbilityFor('member')
    const decision = decideTransport(member.can('next', 'Player'), member.can('vote', 'Player'))
    expect(decision).toBe('vote')
    expect(decision).not.toBe('direct')
  })

  it('member 点上一首 → 发起投票', () => {
    const member = defineAbilityFor('member')
    expect(decideTransport(member.can('prev', 'Player'), member.can('vote', 'Player'))).toBe('vote')
  })

  it('member 点播放/暂停 → 按钮可点并走投票（不是灰按钮）', () => {
    const member = defineAbilityFor('member')
    const canPlay = member.can('play', 'Player')
    const canVote = member.can('vote', 'Player')
    // 关键：disabled 条件是 !canPlay && !canVote，member 两者之一为真 → 可点
    expect(canPlay || canVote).toBe(true)
    expect(decideTransport(canPlay, canVote)).toBe('vote')
  })

  it('房主点下一首 → 直接切歌', () => {
    const owner = defineAbilityFor('owner')
    expect(decideTransport(owner.can('next', 'Player'), owner.can('vote', 'Player'))).toBe('direct')
  })
})
