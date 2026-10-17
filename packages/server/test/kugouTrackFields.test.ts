/**
 * 酷狗字段解析回归测试 —— 钉住**概念版（PascalCase）**与**标准版（小写）**两套命名。
 *
 * 事故背景：概念版搜索返回 `FileName` / `PayType`，旧解析只读
 * `filename / songname / SongName`，于是歌名落到占位名（unknown），
 * 且 VIP 标记丢失。下面第一条用例就是当时的真实抓包。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseKugouSongFields } from '../src/services/kugouTrackFields.js'

/** 酷狗概念版 `gateway.kugou.com/v3/search/song` 的真实返回（已裁剪无关字段）。 */
const CONCEPT_SONG = {
  FileName: '黄大炜 - 你把我灌醉',
  SingerName: '黄大炜',
  OriSongName: '你把我灌醉',
  FileHash: '23C45842E753A5A450489CC21B657B6D',
  Duration: 313,
  AlbumID: 971573,
  AlbumName: '绝对收藏 黄大炜',
  PayType: 3,
  Singers: [{ name: '黄大炜', id: 1123, ip_id: 0 }],
  Image: 'http://imge.kugou.com/stdmusic/{size}/20250101/20250101070839820067.jpg',
}

/** 酷狗标准版 `mobilecdn.kugou.com/api/v3/search/song` 的返回（小写）。 */
const STANDARD_SONG = {
  hash: 'ABC123',
  filename: '周杰伦 - 晴天',
  songname: '晴天',
  singername: '周杰伦',
  album_name: '叶惠美',
  duration: 269,
  privilege: 0,
  trans_param: { union_cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg' },
}

test('概念版 PascalCase：歌名/歌手/专辑/VIP 都要读出来', () => {
  const fields = parseKugouSongFields(CONCEPT_SONG)
  assert.equal(fields.hash, '23C45842E753A5A450489CC21B657B6D')
  // 事故点：旧解析这里会得到空串，调用方再落成 "Unknown"。
  assert.equal(fields.title, '你把我灌醉')
  assert.deepEqual(fields.artists, ['黄大炜'])
  assert.equal(fields.album, '绝对收藏 黄大炜')
  assert.equal(fields.duration, 313)
  assert.equal(fields.vip, true, 'PayType=3 必须被识别为 VIP')
  // 封面保留原始的 {size} 模板，归一化由调用方负责。
  assert.match(fields.cover, /\{size\}/)
})

test('标准版小写字段与改造前行为一致', () => {
  const fields = parseKugouSongFields(STANDARD_SONG)
  assert.equal(fields.hash, 'ABC123')
  assert.equal(fields.title, '晴天')
  assert.deepEqual(fields.artists, ['周杰伦'])
  assert.equal(fields.album, '叶惠美')
  assert.equal(fields.duration, 269)
  assert.equal(fields.vip, false)
})

test('文件名前缀里的 & 视为并列歌手', () => {
  const fields = parseKugouSongFields({ FileHash: 'H1', FileName: 'A & B - 歌名' })
  assert.equal(fields.title, '歌名')
  assert.deepEqual(fields.artists, ['A', 'B'])
})

test('SingerName 里的 & 不拆 —— 可能是名字本身', () => {
  const fields = parseKugouSongFields({ FileHash: 'H2', SingerName: 'Tom & Jerry', OriSongName: '歌名' })
  assert.deepEqual(fields.artists, ['Tom & Jerry'])
})

test('没有文件名时退 OriSongName，歌手退 Singers 数组', () => {
  const fields = parseKugouSongFields({
    FileHash: 'H3',
    OriSongName: '原始歌名',
    Singers: [{ name: '歌手甲' }, { name: '歌手乙' }],
  })
  assert.equal(fields.title, '原始歌名')
  assert.deepEqual(fields.artists, ['歌手甲', '歌手乙'])
})

test('SingerName 支持中英文逗号与顿号分隔', () => {
  const fields = parseKugouSongFields({ FileHash: 'H4', SingerName: '甲，乙、丙', OriSongName: '歌名' })
  assert.deepEqual(fields.artists, ['甲', '乙', '丙'])
})

test('毫秒时长按阈值换算成秒', () => {
  assert.equal(parseKugouSongFields({ FileHash: 'H5', FileName: 'A - B', Duration: 240000 }).duration, 240)
  assert.equal(parseKugouSongFields({ FileHash: 'H6', FileName: 'A - B', Duration: 313 }).duration, 313)
  // 缺失或非法时是 0（shared 里 0 表示未知），不是 NaN。
  assert.equal(parseKugouSongFields({ FileHash: 'H7', FileName: 'A - B' }).duration, 0)
  assert.equal(parseKugouSongFields({ FileHash: 'H8', FileName: 'A - B', Duration: 'oops' }).duration, 0)
})

test('歌名本身含 " - " 时保留完整后缀', () => {
  const fields = parseKugouSongFields({ FileHash: 'H9', FileName: 'A - B - C' })
  assert.equal(fields.title, 'B - C')
  assert.deepEqual(fields.artists, ['A'])
})

test('没有 hash 时返回空串，由调用方跳过该行', () => {
  assert.equal(parseKugouSongFields({ FileName: 'A - B' }).hash, '')
  // 概念版写法同样要被认出来。
  assert.equal(parseKugouSongFields({ FileHash: 'ONLY-CONCEPT' }).hash, 'ONLY-CONCEPT')
})

test('privilege 位掩码 8 也算 VIP', () => {
  assert.equal(parseKugouSongFields({ FileHash: 'H10', privilege: 8 }).vip, true)
  assert.equal(parseKugouSongFields({ FileHash: 'H11', privilege: 0 }).vip, false)
})
