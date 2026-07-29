import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatKugouVipLabel,
  getKugouMembershipResponseData,
  getKugouMembershipRequestEditions,
  getKugouVipQueryParams,
  isKugouInvalidParamsResponse,
  parseKugouMembership,
} from '../src/services/kugouAuthService.js'

test('parses Kugou VIP progression level', () => {
  assert.deepEqual(parseKugouMembership({ is_vip: 1, vip_level: 5 }), {
    vipType: 1,
    vipLabel: 'VIP·Lv5',
    vipLevel: 5,
  })
})

test('prefers Kugou SVIP and omits invalid levels', () => {
  assert.deepEqual(parseKugouMembership({ is_vip: 1, is_svip: 1, vip_level: 0 }), {
    vipType: 2,
    vipLabel: 'SVIP',
    vipLevel: undefined,
  })
  assert.equal(formatKugouVipLabel(0, 5), undefined)
})

test('does not mistake the standard Kugou product code for an SVIP tier', () => {
  assert.deepEqual(parseKugouMembership({ is_vip: 1, vip_type: 6, svip_level: 5 }, false), {
    vipType: 1,
    vipLabel: 'VIP·Lv5',
    vipLevel: 5,
  })
  assert.deepEqual(parseKugouMembership({ vip_type: 6, svip_level: 5 }, false), {
    vipType: 0,
    vipLabel: undefined,
    vipLevel: undefined,
  })
})

test('recognizes standard Kugou SVIP from its active super-VIP expiry', () => {
  const now = Date.parse('2026-07-29T16:00:00+08:00')
  assert.deepEqual(
    parseKugouMembership(
      { is_vip: 1, vip_type: 6, su_vip_end_time: '2026-08-29 16:00:00', svip_level: 5 },
      false,
      now,
    ),
    { vipType: 2, vipLabel: 'SVIP·Lv5', vipLevel: 5 },
  )
  assert.deepEqual(
    parseKugouMembership(
      { is_vip: 1, vip_type: 6, su_vip_end_time: '2026-06-29 16:00:00', svip_level: 5 },
      false,
      now,
    ),
    { vipType: 1, vipLabel: 'VIP·Lv5', vipLevel: 5 },
  )
})

test('reads standard Kugou SVIP fields from nested vipinfo responses', () => {
  const now = Date.parse('2026-07-29T16:00:00+08:00')
  assert.deepEqual(
    parseKugouMembership(
      {
        is_vip: 0,
        su_vip_y_endtime: '',
        vipinfo: { is_vip: 1, vip_type: 6, su_vip_y_endtime: '2027-01-01 00:00:00', svip_level: 9 },
      },
      false,
      now,
    ),
    { vipType: 2, vipLabel: 'SVIP·Lv9', vipLevel: 9 },
  )
})

test('parses a non-paid Concept Edition listening benefit as regular VIP', () => {
  assert.deepEqual(
    parseKugouMembership({
      is_vip: 0,
      vip_type: 0,
      svip_level: 0,
      busi_vip: [
        { is_vip: 1, is_paid_vip: 0, busi_type: 'concept', product_type: 'svip' },
        { is_vip: 1, busi_type: 'concept', product_type: 'tvip' },
      ],
    }),
    { vipType: 1, vipLabel: '畅听VIP', vipLevel: undefined },
  )
})

test('parses a paid Concept Edition SVIP as the master-quality tier', () => {
  assert.deepEqual(
    parseKugouMembership({
      busi_vip: [{ is_vip: 1, is_paid_vip: 1, busi_type: 'concept', product_type: 'svip' }],
    }),
    { vipType: 2, vipLabel: 'SVIP', vipLevel: undefined },
  )
})

test('ignores inactive Concept Edition business memberships', () => {
  assert.deepEqual(
    parseKugouMembership({
      is_vip: 0,
      vip_type: 0,
      busi_vip: [{ is_vip: 0, busi_type: 'concept', product_type: 'svip' }],
    }),
    { vipType: 0, vipLabel: undefined, vipLevel: undefined },
  )
})

test('does not apply Concept Edition business membership to standard Kugou', () => {
  assert.deepEqual(
    parseKugouMembership(
      {
        is_vip: 0,
        vip_type: 0,
        busi_vip: [{ is_vip: 1, busi_type: 'concept', product_type: 'svip' }],
      },
      false,
    ),
    { vipType: 0, vipLabel: undefined, vipLevel: undefined },
  )
})

test('requests the claimed Concept Edition products when checking membership', () => {
  assert.deepEqual(getKugouVipQueryParams('concept'), {
    busi_type: 'concept',
    opt_product_types: 'dvip,qvip',
    product_type: 'svip',
  })
  assert.deepEqual(getKugouVipQueryParams('standard'), { busi_type: 'concept' })
})

test('rejects Kugou API error payloads instead of treating them as non-members', () => {
  assert.equal(getKugouMembershipResponseData({ status: 0, data: {} }), null)
  assert.equal(getKugouMembershipResponseData({ status: 1, data: { errmsg: 'params invalid' } }), null)
  assert.deepEqual(getKugouMembershipResponseData({ status: 1, data: { is_vip: 1 } }), { is_vip: 1 })
})

test('retries membership lookup with the alternate client only for a credential-edition mismatch', () => {
  assert.deepEqual(getKugouMembershipRequestEditions('concept'), ['concept', 'standard'])
  assert.deepEqual(getKugouMembershipRequestEditions('standard'), ['standard', 'concept'])
  assert.equal(isKugouInvalidParamsResponse({ status: 0, error_code: 20017, data: {} }), true)
  assert.equal(isKugouInvalidParamsResponse({ status: 0, data: { errmsg: 'params invalid' } }), true)
  assert.equal(isKugouInvalidParamsResponse({ status: 0, error_code: 20018, data: {} }), false)
})
