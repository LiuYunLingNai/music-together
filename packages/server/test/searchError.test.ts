import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

process.env.LOG_LEVEL = 'silent'
const { searchAlbums } = await import('../src/services/catalogSearch.js')
const { SearchError } = await import('../src/services/catalogUtils.js')

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function answer(body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body))) as typeof fetch
}

test('搜索平台拒绝回答时抛出 SearchError，而不是返回空列表', async () => {
  answer({ errcode: 20010, data: {} })
  await assert.rejects(searchAlbums('kugou', 'x'), SearchError)
})

test('搜索成功但没有命中仍是空列表', async () => {
  answer({ errcode: 0, data: {} })
  assert.deepEqual(await searchAlbums('kugou', 'x'), [])
})
