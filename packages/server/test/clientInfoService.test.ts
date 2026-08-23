import assert from 'node:assert/strict'
import test from 'node:test'
import { getClientInfo } from '../src/services/clientInfoService.js'

test('identifies Chromium browsers without exposing versions', () => {
  const info = getClientInfo({
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="140", "Google Chrome";v="140"',
    'sec-ch-ua-platform': '"Windows"',
  })
  assert.deepEqual(info, { kind: 'web', label: 'Chrome · Windows' })
})

test('identifies Safari on iPhone', () => {
  const info = getClientInfo({
    'user-agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  })
  assert.deepEqual(info, { kind: 'web', label: 'Safari · iPhone' })
})

test('identifies native clients and leaves unknown agents undisclosed', () => {
  assert.deepEqual(getClientInfo({ 'user-agent': 'okhttp/4.12.0' }), {
    kind: 'android',
    label: 'Android 客户端',
  })
  assert.deepEqual(getClientInfo({ 'user-agent': 'Music-Together-Windows/2.3.0' }), {
    kind: 'windows',
    label: 'Windows 客户端',
  })
  assert.equal(getClientInfo({ 'user-agent': 'custom-agent/1.0' }), undefined)
})
