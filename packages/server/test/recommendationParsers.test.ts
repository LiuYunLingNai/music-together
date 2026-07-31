import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBilibiliRecommendedVideos } from '../src/services/bilibiliAuthService.js'
import { parseKugouRecommendationPlaylistIds, parseKugouRecommendationSongs } from '../src/services/kugouAuthService.js'

test('finds Kugou recommendation songs in nested response data', () => {
  const songs = parseKugouRecommendationSongs({ data: { song_list: [{ hash: 'abc123', filename: 'Song' }] } })
  assert.deepEqual(songs, [{ hash: 'abc123', filename: 'Song' }])
})

test('finds unique Kugou recommendation playlist IDs', () => {
  const ids = parseKugouRecommendationPlaylistIds({
    data: { special_list: [{ specialid: 123 }, { special_id: '456' }, { specialid: 123 }, {}] },
  })
  assert.deepEqual(ids, ['123', '456'])
})

test('filters and normalizes Bilibili recommendation videos', () => {
  const videos = parseBilibiliRecommendedVideos({
    item: [
      {
        goto: 'av',
        bvid: 'BV1xx',
        title: '推荐视频',
        owner: { name: 'UP主' },
        duration: 123,
        pic: '//image.test/cover',
      },
      { goto: 'live', bvid: 'BV2xx', title: '直播' },
      { goto: 'av', title: '缺少 BV 号' },
    ],
  })
  assert.deepEqual(videos, [
    { bvid: 'BV1xx', title: '推荐视频', author: 'UP主', duration: 123, cover: 'https://image.test/cover' },
  ])
})
