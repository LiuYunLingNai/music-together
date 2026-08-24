import assert from 'node:assert/strict'
import test from 'node:test'
import { isRoomInviteLink, renderRoomInviteQr } from '../src/services/roomShareService.js'

test('接受指向目标房间的 https 邀请链接', () => {
  assert.equal(isRoomInviteLink('https://sharemusic.lyln114514.com/room/ABC123', 'ABC123'), true)
})

test('接受反向代理 base path 下的邀请链接', () => {
  assert.equal(isRoomInviteLink('https://example.com/music/room/ABC123', 'ABC123'), true)
})

test('接受正式 ROMMid 分享链接', () => {
  assert.equal(isRoomInviteLink('https://sharemusic.lyln114514.com/join?ROMMid=ABC123', 'ABC123'), true)
  assert.equal(
    isRoomInviteLink('https://music.example/app/join?ROMMid=ABC123', 'ABC123'),
    true,
  )
})

test('拒绝房间号不匹配的链接', () => {
  assert.equal(isRoomInviteLink('https://example.com/room/OTHER1', 'ABC123'), false)
})

test('拒绝非 http(s) 协议与畸形链接', () => {
  assert.equal(isRoomInviteLink('musictogether://room/ABC123', 'ABC123'), false)
  assert.equal(isRoomInviteLink('javascript:alert(1)', 'ABC123'), false)
  assert.equal(isRoomInviteLink('not-a-url', 'ABC123'), false)
  assert.equal(isRoomInviteLink('', 'ABC123'), false)
})

test('拒绝带 query 或 hash 的链接', () => {
  assert.equal(isRoomInviteLink('https://example.com/room/ABC123?x=1', 'ABC123'), false)
  assert.equal(isRoomInviteLink('https://example.com/room/ABC123#hash', 'ABC123'), false)
  assert.equal(isRoomInviteLink('https://sharemusic.lyln114514.com/join?ROMMid=OTHER1', 'ABC123'), false)
})

test('拒绝路径不含 room 段的链接', () => {
  assert.equal(isRoomInviteLink('https://example.com/not-a-room/ABC123', 'ABC123'), false)
  assert.equal(isRoomInviteLink('https://example.com/ABC123', 'ABC123'), false)
})

test('拒绝超长链接', () => {
  const longLink = `https://example.com/room/${'A'.repeat(600)}`
  assert.equal(isRoomInviteLink(longLink, 'A'.repeat(600)), false)
})

test('生成二维码 data URL', async () => {
  const qrimg = await renderRoomInviteQr('https://example.com/room/ABC123')
  assert.ok(qrimg.startsWith('data:image/png;base64,'))
})
