import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSameMachineAddress } from '../src/controllers/authController.js'

// 本机 QQ 一键登录探测的是「服务端所在机器」的客户端，
// 只有本地访问时语义才等于「访问者自己的在线 QQ」，因此这个判定是安全边界。

test('回环地址判定为同机', () => {
  assert.equal(isSameMachineAddress('127.0.0.1'), true)
  assert.equal(isSameMachineAddress('127.0.0.5'), true)
  assert.equal(isSameMachineAddress('::1'), true)
  assert.equal(isSameMachineAddress('::ffff:127.0.0.1'), true)
  assert.equal(isSameMachineAddress('localhost'), true)
})

test('局域网与公网地址判定为非同机', () => {
  assert.equal(isSameMachineAddress('192.168.1.20'), false)
  assert.equal(isSameMachineAddress('10.0.0.8'), false)
  assert.equal(isSameMachineAddress('172.16.5.4'), false)
  assert.equal(isSameMachineAddress('::ffff:192.168.1.20'), false)
  assert.equal(isSameMachineAddress('203.0.113.9'), false)
})

test('缺失地址时保守判定为非同机', () => {
  assert.equal(isSameMachineAddress(''), false)
  assert.equal(isSameMachineAddress(undefined as unknown as string), false)
})
