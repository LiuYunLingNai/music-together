import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseKeyIndex, parseUinList } from '../src/services/localQqLoginService.js'

// 真实响应样例：QQ NT 客户端 pt_get_uins 的 JSONP 返回
const REAL_UIN_LIST =
  'var var_sso_uin_list=[{"uin":3445487890,"face_index":0,"gender":0,"nickname":"归途守候你",' +
  '"client_type":65793,"uin_flag":8388608,"account":3445487890}];ptui_getuins_CB(var_sso_uin_list);'

const REAL_GET_ST = 'var var_sso_get_st_uin={uin: 3445487890, keyindex: 19}; ptui_getst_CB(var_sso_get_st_uin);'

test('parseUinList 解析真实 pt_get_uins 响应', () => {
  const list = parseUinList(REAL_UIN_LIST)
  assert.equal(list.length, 1)
  assert.deepEqual(list[0], { uin: '3445487890', nickname: '归途守候你' })
})

test('parseUinList 支持多账号', () => {
  const body =
    'var var_sso_uin_list=[{"uin":100001,"nickname":"甲"},{"uin":100002,"nickname":"乙"}];' +
    'ptui_getuins_CB(var_sso_uin_list);'
  assert.deepEqual(parseUinList(body), [
    { uin: '100001', nickname: '甲' },
    { uin: '100002', nickname: '乙' },
  ])
})

test('parseUinList 对非 JSONP 内容返回空数组', () => {
  assert.deepEqual(parseUinList(''), [])
  assert.deepEqual(parseUinList('<html>error</html>'), [])
  assert.deepEqual(parseUinList('var var_sso_uin_list=[];ptui_getuins_CB(var_sso_uin_list);'), [])
})

test('parseUinList 过滤掉 uin 不合法的条目', () => {
  const body =
    'var var_sso_uin_list=[{"uin":"abc","nickname":"坏"},{"uin":3445487890,"nickname":"好"}];' +
    'ptui_getuins_CB(var_sso_uin_list);'
  const list = parseUinList(body)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.uin, '3445487890')
})

test('parseKeyIndex 解析真实 pt_get_st 响应', () => {
  assert.equal(parseKeyIndex(REAL_GET_ST), '19')
})

test('parseKeyIndex 缺失时返回 null', () => {
  assert.equal(parseKeyIndex('var var_sso_get_st_uin={uin: 1};'), null)
  assert.equal(parseKeyIndex(''), null)
})
