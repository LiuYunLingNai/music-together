import { describe, expect, it } from 'vitest'
import {
  APP_LINK_CONSTANTS,
  buildAndroidIntentUrl,
  buildRoomBrowserUrl,
  buildRoomAppLink,
  buildRoomWebUrl,
  isAndroidUserAgent,
  resolveRoomOpenUrl,
  resolveShareBaseUrl,
} from './appLink'

const SERVER = 'https://sharemusic.lyln114514.com'
const OTHER_SERVER = 'https://music.example/app'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('房间分享链接构造', () => {
  it('公开分享地址优先使用当前页面域名', () => {
    expect(resolveShareBaseUrl('http://10.159.68.229:3001', SERVER)).toBe('http://10.159.68.229:3001')
    expect(resolveShareBaseUrl('https://room.example/', SERVER)).toBe('https://room.example')
    expect(resolveShareBaseUrl(null, SERVER)).toBe(SERVER)
  })

  it('生成与安卓端一致的网页房间地址并忽略末尾斜杠', () => {
    expect(buildRoomWebUrl('CDIBR9', `${SERVER}//`)).toBe(`${SERVER}/join?ROMMid=CDIBR9`)
  })

  it('自定义 scheme 链接携带服务端地址便于跨服务端进房', () => {
    expect(buildRoomAppLink('CDIBR9', SERVER)).toBe(
      `musictogether://join?ROMMid=CDIBR9&server=${encodeURIComponent(SERVER)}`,
    )
  })

  it('服务端地址缺失时仍可生成仅带房间号的 scheme 链接', () => {
    expect(buildRoomAppLink('CDIBR9', '')).toBe('musictogether://join?ROMMid=CDIBR9')
  })

  it('intent 链接包含包名、scheme 与网页回退地址', () => {
    const webUrl = buildRoomWebUrl('CDIBR9', SERVER)
    const intentUrl = buildAndroidIntentUrl('CDIBR9', SERVER, webUrl)

    expect(intentUrl.startsWith(`intent://join?ROMMid=CDIBR9&server=${encodeURIComponent(SERVER)}#Intent;`)).toBe(true)
    expect(intentUrl).toContain(`package=${APP_LINK_CONSTANTS.androidPackage}`)
    expect(intentUrl).toContain(`scheme=${APP_LINK_CONSTANTS.scheme}`)
    expect(intentUrl).toContain(`S.browser_fallback_url=${encodeURIComponent(webUrl)}`)
    expect(intentUrl.endsWith(';end')).toBe(true)
  })

  it('识别安卓 UA，其他平台不误判', () => {
    expect(isAndroidUserAgent(ANDROID_UA)).toBe(true)
    expect(isAndroidUserAgent(IOS_UA)).toBe(false)
    expect(isAndroidUserAgent(undefined)).toBe(false)
  })

  it('安卓浏览器走 intent 唤起，其他平台退回自定义 scheme', () => {
    expect(resolveRoomOpenUrl('CDIBR9', SERVER, ANDROID_UA).startsWith('intent://')).toBe(true)
    expect(resolveRoomOpenUrl('CDIBR9', SERVER, IOS_UA).startsWith('musictogether://')).toBe(true)
  })

  it('分享链接使用当前服务端域名并通过 ROMMid 传递房间号', () => {
    expect(buildRoomWebUrl('A/B', SERVER)).toBe(`${SERVER}/join?ROMMid=A%2FB`)
    expect(buildRoomWebUrl('CDIBR9', OTHER_SERVER)).toBe(`${OTHER_SERVER}/join?ROMMid=CDIBR9`)
  })

  it('网页落地页的网页版回退仍指向服务端房间页', () => {
    expect(buildRoomBrowserUrl('CDIBR9', SERVER)).toBe(`${SERVER}/room/CDIBR9`)
  })
})
