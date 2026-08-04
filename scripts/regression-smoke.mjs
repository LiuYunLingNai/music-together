import WebSocket from 'ws'

const port = Number(process.env.MT_ELECTRON_DEBUG_PORT || 9224)
const serverUrl = process.env.MT_SERVER_URL || 'https://0music.qqun.top:9872'
const deadlineMs = 30_000

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function assert(value, message) { if (!value) throw new Error(message) }

async function waitForTarget() {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (target) return target
    } catch {
      // Electron may still be starting.
    }
    await delay(250)
  }
  throw new Error('Electron remote debugging target did not appear')
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Electron evaluation failed')
    return result.result?.value
  }
  close() { this.socket.close() }
}

async function poll(cdp, expression, label, timeout = deadlineMs) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await cdp.evaluate(expression)
    if (value) return value
    await delay(250)
  }
  const body = await cdp.evaluate(`document.body?.innerText?.slice(0, 700) || ''`)
  throw new Error(`timeout waiting for ${label}; page: ${body}`)
}

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function connect(cdp, nickname) {
  await cdp.evaluate(`(() => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(document.querySelector("input[aria-label='服务器地址']"), ${JSON.stringify(serverUrl)});
    setValue(document.querySelector("input[aria-label='昵称']"), ${JSON.stringify(nickname)});
    document.querySelector('.connection-form').requestSubmit();
    return true;
  })()`)
  await poll(cdp, `document.querySelector('.stage-heading')?.textContent?.includes('选择一个房间')`, 'online lobby')
}

async function createRoom(cdp, name) {
  await cdp.evaluate(`document.querySelector("button[title='创建房间']").click()`)
  await poll(cdp, `Boolean(document.querySelector('.create-room'))`, 'create room form')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.create-room input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.create-room').requestSubmit();
    return true;
  })()`)
  await poll(cdp, `Boolean(document.querySelector('.room-panel') && document.querySelector('.transport'))`, 'created room')
}

async function main() {
  const target = await waitForTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  const suffix = Date.now().toString(36).slice(-7)
  const accountId = `desktopqa_${suffix}`
  const password = `Qa-${suffix}-password`
  const nickname = `Desktop QA ${suffix}`
  try {
    await cdp.open()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await poll(cdp, `Boolean(window.desktop?.logoutIdentity && document.querySelector("input[aria-label='服务器地址']"))`, 'desktop bridge')

    await cdp.evaluate(`window.desktop.logoutIdentity(${JSON.stringify(serverUrl)})`)
    await cdp.send('Page.reload', { ignoreCache: true })
    await poll(cdp, `Boolean(document.querySelector("input[aria-label='服务器地址']"))`, 'fresh guest app')
    await connect(cdp, nickname)

    const account = await cdp.evaluate(`(async () => {
      const request = async (path, init) => {
        const response = await fetch(${JSON.stringify(serverUrl)} + path, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
        const text = await response.text();
        if (!response.ok) throw new Error(text || String(response.status));
        return text ? JSON.parse(text) : null;
      };
      await request('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ nickname: ${JSON.stringify(nickname)} }) });
      await window.desktop.updateAccountId(${JSON.stringify(serverUrl)}, ${JSON.stringify(accountId)});
      await request('/api/auth/me/password', { method: 'POST', body: JSON.stringify({ password: ${JSON.stringify(password)} }) });
      return request('/api/auth/me');
    })()`)
    assert(account?.id === accountId && account?.hasPassword, 'failed to create protected online test account')
    console.log(`OK protected account created through Electron cookie bridge: ${accountId}`)

    const guest = await cdp.evaluate(`window.desktop.logoutIdentity(${JSON.stringify(serverUrl)})`)
    assert(guest?.userId && guest.userId !== accountId, 'logout did not issue a new guest identity')
    await cdp.send('Page.reload', { ignoreCache: true })
    await poll(cdp, `Boolean(document.querySelector("input[aria-label='服务器地址']"))`, 'guest reload')
    await connect(cdp, `Guest ${suffix}`)

    await cdp.evaluate(`document.querySelector('.sidebar-account-button').click()`)
    await poll(cdp, `Boolean(document.querySelector('.settings-window'))`, 'lobby account settings')
    await poll(cdp, `Boolean(document.querySelector("input[placeholder='账号 ID']"))`, 'account settings')
    assert(!Array.from(document.querySelectorAll('.settings-nav nav button')).some((button) => button.textContent.includes('房间与成员')), 'room settings are available before joining a room')
    await cdp.evaluate(`(() => {
      const setValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue(document.querySelector("input[placeholder='账号 ID']"), ${JSON.stringify(accountId)});
      setValue(document.querySelector("input[placeholder='密码']"), ${JSON.stringify(password)});
      document.querySelector('.login-grid .button--primary').click();
      return true;
    })()`)
    await poll(cdp, `document.querySelector('.profile-editor code')?.textContent === ${JSON.stringify(accountId)}`, 'recovered profile in UI')
    const recovered = await cdp.evaluate(`fetch(${JSON.stringify(`${serverUrl}/api/auth/me`)}, { credentials: 'include' }).then((response) => response.json())`)
    assert(recovered?.id === accountId, 'renderer requests still use the anonymous identity after login')
    console.log('OK settings login recovered the protected account and updated the visible profile')

    await cdp.evaluate(`Array.from(document.querySelectorAll('.settings-nav nav button')).find((button) => button.textContent.includes('外观主题')).click()`)
    await poll(cdp, `document.querySelectorAll('.theme-segment button').length === 3`, 'three theme modes')
    await cdp.evaluate(`Array.from(document.querySelectorAll('.theme-segment button')).find((button) => button.textContent.includes('自动')).click()`)
    await delay(700)
    await poll(cdp, `document.querySelector('.theme-segment button.is-active')?.textContent?.includes('自动')`, 'theme baseline')
    await cdp.evaluate(`(() => {
      const nativeAnimate = document.documentElement.animate.bind(document.documentElement);
      window.__themeAnimations = [];
      document.documentElement.animate = (frames, options) => {
        window.__themeAnimations.push({ frames, options });
        return nativeAnimate(frames, options);
      };
      return true;
    })()`)
    const themeTarget = await cdp.evaluate(`(() => {
      const next = document.documentElement.dataset.theme === 'dark' ? '白天' : '夜间';
      const button = Array.from(document.querySelectorAll('.theme-segment button')).find((candidate) => candidate.textContent.includes(next));
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, next };
    })()`)
    await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.theme-segment button')).find((candidate) => candidate.textContent.includes(${JSON.stringify(themeTarget.next)}));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${themeTarget.x}, clientY: ${themeTarget.y} }));
      return true;
    })()`)
    await poll(cdp, `window.__themeAnimations?.some((entry) => entry.options?.pseudoElement === '::view-transition-new(root)')`, 'circular theme transition')
    const themeState = await cdp.evaluate(`(() => {
      const entry = window.__themeAnimations.find((item) => item.options?.pseudoElement === '::view-transition-new(root)');
      return { theme: document.documentElement.dataset.theme, first: entry?.frames?.clipPath?.[0], last: entry?.frames?.clipPath?.[1], duration: entry?.options?.duration };
    })()`)
    const circleOrigin = /at ([\d.]+)px ([\d.]+)px/.exec(themeState.first || '')
    assert(circleOrigin && Math.abs(Number(circleOrigin[1]) - themeTarget.x) <= 1 && Math.abs(Number(circleOrigin[2]) - themeTarget.y) <= 1 && themeState.last?.startsWith('circle('), 'theme circle is not centered on the click')
    assert(themeState.duration >= 500, 'theme transition ended too quickly')
    await delay(themeState.duration + 150)
    const autoRect = await cdp.evaluate(`(() => { const button = Array.from(document.querySelectorAll('.theme-segment button')).find((candidate) => candidate.textContent.includes('自动')); const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`)
    await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.theme-segment button')).find((candidate) => candidate.textContent.includes('自动'));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${autoRect.x}, clientY: ${autoRect.y} }));
      return true;
    })()`)
    await poll(cdp, `document.querySelector('.theme-segment button.is-active')?.textContent?.includes('自动')`, 'automatic theme mode')
    console.log('OK auto/light/dark theme modes and click-centered circular transition')

    const typography = await cdp.evaluate(`(() => ({
      body: parseFloat(getComputedStyle(document.body).fontSize),
      input: parseFloat(getComputedStyle(document.querySelector('.connection-form input')).fontSize),
      muted: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(),
    }))()`)
    assert(typography.body >= 14 && typography.input >= 13, 'application typography is still too small')
    console.log('OK larger high-contrast application typography')

    await cdp.evaluate(`document.querySelector("button[title='关闭设置']").click()`)
    await poll(cdp, `!document.querySelector('.settings-window')`, 'settings close')
    await poll(cdp, `Boolean(document.querySelector("button[title='创建房间']"))`, 'reconnected lobby')
    await createRoom(cdp, `Controls ${suffix}`)
    await cdp.evaluate(`document.querySelector("button[title='收起右侧栏']").click()`)
    await poll(cdp, `document.querySelector('.workspace--room-collapsed') && document.querySelector('.room-panel__expand')`, 'collapsed room panel')
    await cdp.evaluate(`document.querySelector("button[title='展开右侧栏']").click()`)
    await poll(cdp, `!document.querySelector('.workspace--room-collapsed') && document.querySelector("button[title='收起右侧栏']")`, 'expanded room panel')
    await cdp.evaluate(`document.querySelector(".now-playing__actions button[title='搜索并点歌']").click()`)
    await poll(cdp, `Boolean(document.querySelector('.search-dialog'))`, 'search')
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search-form input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '晴天');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.search-form').requestSubmit();
      return true;
    })()`)
    await poll(cdp, `document.querySelectorAll(".search-result button[title='加入队列']").length > 0`, 'search result')
    await cdp.evaluate(`document.querySelector(".search-result button[title='加入队列']").click(); document.querySelector(".search-dialog button[title='关闭']").click()`)
    await poll(cdp, `document.querySelectorAll('.lyric-line').length >= 5 && Boolean(document.querySelector('.progress-control input'))`, 'lyrics and transport', 45_000)

    await cdp.evaluate(`document.documentElement.dataset.theme = 'light'; document.querySelector('.now-playing__actions button:nth-child(3)').click()`)
    const lightSurfaces = await cdp.evaluate(`(() => {
      const read = (selector) => { const style = getComputedStyle(document.querySelector(selector)); return { background: style.backgroundColor, color: style.color }; };
      return { play: read('.play-button'), offset: read('.offset-popover') };
    })()`)
    assert(lightSurfaces.play.background !== 'rgb(23, 27, 34)' && lightSurfaces.play.color === 'rgb(255, 255, 255)', 'light-mode playback button has insufficient contrast')
    assert(lightSurfaces.offset.background === 'rgb(255, 255, 255)', 'light-mode lyric offset popover is still dark')

    const lyricBeforeScale = await cdp.evaluate(`getComputedStyle(document.querySelector('.karaoke-main')).fontSize`)
    await cdp.evaluate(`document.querySelector('.now-playing__actions button:nth-child(2)').click()`)
    await poll(cdp, `Boolean(document.querySelector('.copy-field code'))`, 'room settings code')
    const roomCodeColors = await cdp.evaluate(`(() => { const style = getComputedStyle(document.querySelector('.copy-field code')); return { background: style.backgroundColor, color: style.color }; })()`)
    assert(roomCodeColors.background === 'rgb(255, 255, 255)' && roomCodeColors.color !== roomCodeColors.background, 'light-mode room code field is unreadable')
    await cdp.evaluate(`document.querySelectorAll('.settings-nav nav button')[3].click()`)
    await poll(cdp, `Boolean(document.querySelector('.range-setting input[type=range]'))`, 'UI scale setting')
    await cdp.evaluate(`(() => { const input = document.querySelector('.range-setting input[type=range]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '1.3'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.settings-close').click(); return true; })()`)
    await delay(250)
    const scaledUi = await cdp.evaluate(`({ zoom: getComputedStyle(document.querySelector('#root')).zoom, lyricFont: getComputedStyle(document.querySelector('.karaoke-main')).fontSize })`)
    assert(Math.abs(Number(scaledUi.zoom) - 1.3) < 0.01, 'global UI scale did not update')
    assert(scaledUi.lyricFont === lyricBeforeScale, 'global UI scale changed the lyric font size')
    console.log('OK light-mode controls, room code, and independent global UI scaling')

    const lyricBeforeMaximize = await cdp.evaluate(`getComputedStyle(document.querySelector('.karaoke-main')).fontSize`)
    await cdp.evaluate(`window.desktop.isMaximized().then((maximized) => { if (!maximized) window.desktop.toggleMaximize() })`)
    await delay(700)
    const lyricAfterMaximize = await cdp.evaluate(`getComputedStyle(document.querySelector('.karaoke-main')).fontSize`)
    assert(lyricAfterMaximize === lyricBeforeMaximize, 'maximizing the window changed lyric font size')
    console.log('OK lyric density remains stable when the window is maximized')

    const geometry = await cdp.evaluate(`(() => {
      const measure = (inputSelector, trackSelector) => {
        const input = document.querySelector(inputSelector).getBoundingClientRect();
        const track = document.querySelector(trackSelector).getBoundingClientRect();
        return { inputLeft: input.left, inputRight: input.right, trackLeft: track.left, trackRight: track.right, y: track.top + track.height / 2 };
      };
      return { progress: measure("input[aria-label='播放进度']", '.progress-track'), volume: measure("input[aria-label='音量']", '.volume-track') };
    })()`)
    const rangeInset = 6 * Number(scaledUi.zoom)
    for (const [name, value] of Object.entries(geometry)) {
      assert(Math.abs(value.trackLeft - (value.inputLeft + rangeInset)) < 0.75, `${name} left endpoint is misaligned`)
      assert(Math.abs(value.trackRight - (value.inputRight - rangeInset)) < 0.75, `${name} right endpoint is misaligned`)
    }
    await clickAt(cdp, geometry.volume.trackLeft, geometry.volume.y)
    await poll(cdp, `Number(document.querySelector("input[aria-label='音量']").value) <= 0.01`, 'volume minimum')
    await clickAt(cdp, geometry.volume.trackRight, geometry.volume.y)
    await poll(cdp, `Number(document.querySelector("input[aria-label='音量']").value) >= 0.99`, 'volume maximum')
    console.log('OK progress and volume visual tracks match native drag endpoints')

    await cdp.evaluate(`(() => {
      const scroll = document.querySelector('.lyrics-scroll');
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1200 }));
      scroll.scrollTop = scroll.scrollHeight;
      return true;
    })()`)
    await delay(200)
    const lyricsLayout = await cdp.evaluate(`(() => {
      const stage = document.querySelector('.main-stage');
      const header = document.querySelector('.now-playing__header');
      const buttons = Array.from(document.querySelectorAll('.now-playing__actions button'));
      const hit = buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return target === button || button.contains(target);
      });
      return { stageScrollTop: stage.scrollTop, headerTop: header.getBoundingClientRect().top, stageTop: stage.getBoundingClientRect().top, hit, filter: getComputedStyle(document.querySelector('.lyric-line')).filter };
    })()`)
    assert(lyricsLayout.stageScrollTop === 0 && Math.abs(lyricsLayout.headerTop - lyricsLayout.stageTop) < 1 && lyricsLayout.hit, 'lyrics scrolling obscures the header actions')
    assert(lyricsLayout.filter === 'none', 'lyrics still have a default blur filter')
    console.log('OK lyrics scroll stays isolated and toolbar actions remain unobscured')

    await cdp.evaluate(`document.querySelector("button[title='离开房间']")?.click()`)
    await cdp.evaluate(`document.querySelector('.connection-form button[type=button]')?.click()`)
    await delay(7_000)
    const stayedDisconnected = await cdp.evaluate(`Boolean(document.querySelector('.connection-form .button--primary'))`)
    assert(stayedDisconnected, 'manual disconnect restarted the reconnect loop')
    console.log('OK manual disconnect remains disconnected until explicit reconnect')
    console.log('REGRESSION_SMOKE_OK')
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`REGRESSION_SMOKE_FAILED: ${error.message}`)
  process.exitCode = 1
})
