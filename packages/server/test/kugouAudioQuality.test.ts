import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectKugouV6Goods,
  kugouProviderQualityToAudioQuality,
  selectKugouV6Good,
} from '../src/services/kugouAudioQuality.js'

function good(quality: string, info: Record<string, unknown> = {}) {
  return {
    quality,
    hash: `${quality}-hash`,
    status: 1,
    info: {
      tracker_status: 1,
      tracker_type: 'full',
      ...info,
    },
  }
}

test('keeps usable plain and encrypted v6 goods and filters unavailable trackers', () => {
  const goods = collectKugouV6Goods({
    data: [
      good('viper_clear', { bitrate: 3490, tracker_url: 'https://cdn.test/clear.flac' }),
      good('flac', {
        bitrate: 999,
        en_tracker_url: 'https://cdn.test/lossless.mflac',
        en_extname: 'mflac',
        en_ekey: 'encoded-key',
      }),
      good('viper_atmos', { bitrate: 2000, tracker_url: 'https://cdn.test/atmos.flac' }),
      good('viper_clear', { bitrate: 3490, tracker_url: 'https://cdn.test/duplicate.flac', tracker_type: 'part' }),
      good('320', { bitrate: 320, tracker_url: 'https://cdn.test/320.mp3', tracker_status: 0 }),
    ],
  })

  assert.deepEqual(goods.map((item) => item.quality), ['viper_clear', 'flac'])
  assert.equal(goods[1]?.encryptedExtension, 'mflac')
})

test('highest chooses the highest technical stereo bitrate, not viper_tape', () => {
  const goods = collectKugouV6Goods({
    data: [
      good('viper_tape', { bitrate: 320, tracker_url: 'https://cdn.test/tape.mp3' }),
      good('high', { bitrate: 1596, tracker_url: 'https://cdn.test/high.flac' }),
      good('viper_clear', { bitrate: 3490, tracker_url: 'https://cdn.test/clear.flac' }),
    ],
  })

  assert.equal(selectKugouV6Good(goods, 'kugou_hires')?.quality, 'viper_clear')
  assert.equal(selectKugouV6Good(goods, 'highest')?.quality, 'viper_clear')
  assert.equal(selectKugouV6Good(goods, 'kugou_master')?.quality, 'viper_tape')
})

test('maps provider labels to the room quality telemetry labels', () => {
  assert.equal(kugouProviderQualityToAudioQuality('viper_tape'), 'kugou_master')
  assert.equal(kugouProviderQualityToAudioQuality('viper_clear'), 'kugou_hires')
  assert.equal(kugouProviderQualityToAudioQuality('flac'), 999)
  assert.equal(kugouProviderQualityToAudioQuality('320'), 320)
})
