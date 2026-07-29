import assert from 'node:assert/strict'
import test from 'node:test'
import { collectBilibiliAudioCandidates, selectBilibiliAudioCandidate } from '../src/services/bilibiliAudioQuality.js'

const dash = {
  audio: [
    { id: 30216, bandwidth: 65_000, codecs: 'mp4a.40.2', baseUrl: 'https://example.test/64' },
    { id: 30232, bandwidth: 82_000, codecs: 'mp4a.40.2', baseUrl: 'https://example.test/132' },
    { id: 30280, bandwidth: 181_000, codecs: 'mp4a.40.2', baseUrl: 'https://example.test/192' },
  ],
  dolby: {
    audio: [{ id: 30250, bandwidth: 448_000, codecs: 'ec-3', baseUrl: 'https://example.test/dolby' }],
  },
  flac: {
    audio: { id: 30251, bandwidth: 1_550_000, codecs: 'fLaC', baseUrl: 'https://example.test/hires' },
  },
}

test('collects regular and Hi-Res tracks while ignoring browser-incompatible Dolby', () => {
  const candidates = collectBilibiliAudioCandidates(dash)
  assert.deepEqual(
    candidates.map(({ quality, format }) => [quality, format]),
    [
      ['bilibili_64', 'm4a'],
      ['bilibili_132', 'm4a'],
      ['bilibili_192', 'm4a'],
      ['bilibili_hires', 'flac'],
    ],
  )
})

test('caps anonymous playback at 192 even if premium tracks are present', () => {
  const selected = selectBilibiliAudioCandidate(collectBilibiliAudioCandidates(dash), 'bilibili_192')
  assert.equal(selected?.quality, 'bilibili_192')
  assert.equal(selected?.id, 30280)
})

test('selects Hi-Res for a member when the video provides it', () => {
  const selected = selectBilibiliAudioCandidate(collectBilibiliAudioCandidates(dash), 'bilibili_hires')
  assert.equal(selected?.quality, 'bilibili_hires')
  assert.equal(selected?.format, 'flac')
})

test('uses 192 when Hi-Res is unavailable even if Bilibili returns Dolby', () => {
  const withoutHires = { ...dash, flac: { audio: null } }
  const selected = selectBilibiliAudioCandidate(collectBilibiliAudioCandidates(withoutHires), 'bilibili_hires')
  assert.equal(selected?.quality, 'bilibili_192')
})

test('uses 192 from the same response when the video has no premium audio', () => {
  const regularOnly = { audio: dash.audio }
  const selected = selectBilibiliAudioCandidate(collectBilibiliAudioCandidates(regularOnly), 'bilibili_hires')
  assert.equal(selected?.quality, 'bilibili_192')
})

test('honors a lower room target without probing other quality URLs', () => {
  const selected = selectBilibiliAudioCandidate(collectBilibiliAudioCandidates(dash), 'bilibili_132')
  assert.equal(selected?.quality, 'bilibili_132')
  assert.equal(selected?.id, 30232)
})
