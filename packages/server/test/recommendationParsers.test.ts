import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBilibiliRecommendedVideos } from '../src/services/bilibiliAuthService.js'
import { parseKugouRecommendationSongs } from '../src/services/kugouAuthService.js'
import {
  parseTencentRecommendationSongMids,
  parseTencentRecommendationSongs,
} from '../src/services/tencentAuthService.js'

test('parses QQ Music recommendation song mids from escaped HTML', () => {
  const html = String.raw`<div songmid=\"mid-one\"></div><div songmid="mid-two"></div><div songmid="mid-one"></div>`
  assert.deepEqual(parseTencentRecommendationSongMids(html), ['mid-one', 'mid-two'])
})

test('parses QQ Music native recommendation songs', () => {
  const songs = parseTencentRecommendationSongs({
    songlist: [{ musicData: { mid: 'mid-one', name: '推荐歌曲' } }, { mid: 'mid-two', name: '另一首' }],
  })
  assert.deepEqual(songs, [{ mid: 'mid-one', name: '推荐歌曲' }, { mid: 'mid-two', name: '另一首' }])
})

test('finds Kugou recommendation songs in nested response data', () => {
  const songs = parseKugouRecommendationSongs({ data: { song_list: [{ hash: 'abc123', filename: 'Song' }] } })
  assert.deepEqual(songs, [{ hash: 'abc123', filename: 'Song' }])
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
