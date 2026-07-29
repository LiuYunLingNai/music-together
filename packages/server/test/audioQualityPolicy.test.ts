import assert from 'node:assert/strict'
import test from 'node:test'
import { getEffectiveQuality } from '../src/services/audioQualityPolicy.js'

test('selects one provider quality from the highest logged-in membership tier', () => {
  assert.equal(getEffectiveQuality('netease', 'highest', 0), 320)
  assert.equal(getEffectiveQuality('netease', 'highest', 1), 'netease_jyeffect')
  assert.equal(getEffectiveQuality('netease', 'highest', 2), 'netease_master')
  assert.equal(getEffectiveQuality('tencent', 'highest', 1), 'tencent_flac')
  assert.equal(getEffectiveQuality('tencent', 'highest', 2), 'tencent_master')
  assert.equal(getEffectiveQuality('kugou', 'highest', 1), 'kugou_hires')
  assert.equal(getEffectiveQuality('kugou', 'highest', 2), 'kugou_master')
  assert.equal(getEffectiveQuality('kugou_concept', 'highest', 1), 'kugou_hires')
  assert.equal(getEffectiveQuality('kugou_concept', 'highest', 2), 'kugou_master')
})

test('caps explicit and cross-platform master preferences at the account tier', () => {
  assert.equal(getEffectiveQuality('netease', 'netease_master', 1), 'netease_jyeffect')
  assert.equal(getEffectiveQuality('netease', 'tencent_master', 1), 'netease_jyeffect')
  assert.equal(getEffectiveQuality('tencent', 'netease_master', 1), 'tencent_flac')
})

test('preserves an exact provider tier when the account permits it', () => {
  assert.equal(getEffectiveQuality('netease', 'netease_dolby', 2), 'netease_dolby')
  assert.equal(getEffectiveQuality('netease', 'netease_hires', 1), 'netease_hires')
  assert.equal(getEffectiveQuality('tencent', 320, 2), 320)
})
