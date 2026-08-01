import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTencentVipLabel, parseTencentMembership } from '../src/services/tencentAuthService.js'

test('parses QQ Music super membership and progression level', () => {
  assert.deepEqual(
    parseTencentMembership({
      identity: { svip: 1, level: 6 },
    }),
    {
      vipType: 2,
      vipLabel: '超级会员·Lv6',
      vipLevel: 6,
    },
  )
})

test('ignores top-level svip and parses identity vip as green diamond VIP', () => {
  assert.deepEqual(parseTencentMembership({ svip: 1, identity: { vip: 1, level: 3 } }), {
    vipType: 1,
    vipLabel: '绿钻VIP·Lv3',
    vipLevel: 3,
  })
})

test('supports identity LMFlag and ignores top-level flags for non-members', () => {
  assert.deepEqual(parseTencentMembership({ identity: { LMFlag: 1, level: 3 } }), {
    vipType: 1,
    vipLabel: '绿钻VIP·Lv3',
    vipLevel: 3,
  })
  assert.deepEqual(parseTencentMembership({ vip: 1, svip: 1, identity: { level: 6 } }), {
    vipType: 0,
    vipLabel: undefined,
    vipLevel: undefined,
  })
  assert.equal(formatTencentVipLabel(0, 6), undefined)
})
