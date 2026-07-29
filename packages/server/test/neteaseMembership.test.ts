import assert from 'node:assert/strict'
import test from 'node:test'
import { formatNeteaseVipLabel, parseNeteaseMembership } from '../src/services/neteaseAuthService.js'

test('formats detailed Netease VIP progression labels', () => {
  assert.equal(formatNeteaseVipLabel(1, 5), 'VIP·伍')
  assert.equal(formatNeteaseVipLabel(2, 5), 'SVIP·伍')
  assert.equal(formatNeteaseVipLabel(1), 'VIP')
  assert.equal(formatNeteaseVipLabel(0, 5), undefined)
})

test('parses regular VIP and redVipLevel from vip_info_v2', () => {
  assert.deepEqual(parseNeteaseMembership(11, { redVipLevel: 5 }), {
    vipType: 1,
    vipLabel: 'VIP·伍',
    vipLevel: 5,
  })
})

test('parses active redplus membership as SVIP', () => {
  assert.deepEqual(
    parseNeteaseMembership(
      11,
      {
        redVipLevel: 5,
        redplus: { vipCode: 220, expireTime: 2_000 },
      },
      1_000,
    ),
    {
      vipType: 2,
      vipLabel: 'SVIP·伍',
      vipLevel: 5,
    },
  )
})

test('does not expose a progression label for a non-member', () => {
  assert.deepEqual(parseNeteaseMembership(0, { redVipLevel: 5 }), {
    vipType: 0,
    vipLabel: undefined,
    vipLevel: undefined,
  })
})
