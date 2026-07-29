import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTencentVipLabel, parseTencentMembership } from '../src/services/tencentAuthService.js'

test('parses QQ Music luxury green diamond and progression level', () => {
  assert.deepEqual(
    parseTencentMembership({
      svip: 1,
      identity: { vip: 1, HugeVip: 1, level: 6 },
    }),
    {
      vipType: 2,
      vipLabel: '豪华绿钻·Lv6',
      vipLevel: 6,
    },
  )
})

test('parses regular QQ Music green diamond and ignores a level for non-members', () => {
  assert.deepEqual(parseTencentMembership({ identity: { vip: 1, level: 3 } }), {
    vipType: 1,
    vipLabel: '绿钻·Lv3',
    vipLevel: 3,
  })
  assert.deepEqual(parseTencentMembership({ identity: { level: 6 } }), {
    vipType: 0,
    vipLabel: undefined,
    vipLevel: undefined,
  })
  assert.equal(formatTencentVipLabel(0, 6), undefined)
})
