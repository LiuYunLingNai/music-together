import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBilibiliMembership } from '../src/services/bilibiliAuthService.js'

test('distinguishes regular and annual Bilibili memberships', () => {
  assert.deepEqual(parseBilibiliMembership(1, 1), {
    vipType: 1,
    vipLabel: '大会员',
  })
  assert.deepEqual(parseBilibiliMembership(1, 2), {
    vipType: 2,
    vipLabel: '年度大会员',
  })
})

test('does not trust a stale provider membership type when VIP is inactive', () => {
  assert.deepEqual(parseBilibiliMembership(0, 2), {
    vipType: 0,
    vipLabel: undefined,
  })
})
