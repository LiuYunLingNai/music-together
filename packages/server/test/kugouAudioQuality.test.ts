import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectKugouV6Goods,
  kugouProviderQualityToAudioQuality,
  selectKugouV6Good,
} from '../src/services/kugouAudioQuality.js'
import {
  canRedirectKugouAudioDirect,
  isKugouConceptAudioUrl,
  isKugouEncryptedAudioUrl,
  normalizeKugouAudioUrl,
} from '../src/services/kugouAudioUrl.js'

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

test('keeps Concept Edition CDN URLs on HTTP while upgrading standard Kugou CDN URLs', () => {
  assert.equal(
    normalizeKugouAudioUrl('https://fs.youthandroid2.kugou.com:443/audio/test.flac?token=abc'),
    'http://fs.youthandroid2.kugou.com/audio/test.flac?token=abc',
  )
  assert.equal(
    normalizeKugouAudioUrl('http://fsandroid.kugou.com/audio/test.flac'),
    'https://fsandroid.kugou.com/audio/test.flac',
  )
})

test('redirects only unprotected standard Kugou audio when forced proxy is disabled', () => {
  const standardUrl = 'https://fsandroid.kugou.com/audio/test.flac'
  const conceptUrl = 'http://fs.youthandroid.kugou.com/audio/test.flac'

  assert.equal(isKugouConceptAudioUrl(standardUrl), false)
  assert.equal(isKugouConceptAudioUrl(conceptUrl), true)
  assert.equal(isKugouEncryptedAudioUrl('https://fsandroid.kugou.com/audio/test.mflac'), true)
  assert.equal(isKugouEncryptedAudioUrl(standardUrl), false)
  assert.equal(canRedirectKugouAudioDirect(standardUrl, false, false), true)
  assert.equal(canRedirectKugouAudioDirect(standardUrl, true, false), false)
  assert.equal(canRedirectKugouAudioDirect(standardUrl, false, true), false)
  assert.equal(canRedirectKugouAudioDirect(conceptUrl, false, false), false)
})

test('normalizes Concept Edition tracker URLs before they reach the audio proxy', () => {
  const goods = collectKugouV6Goods({
    data: [
      good('flac', {
        bitrate: 940,
        tracker_url: 'https://fs.youthandroid.kugou.com/audio/concept.flac',
      }),
    ],
  })

  assert.equal(goods[0]?.plainUrl, 'http://fs.youthandroid.kugou.com/audio/concept.flac')
})
