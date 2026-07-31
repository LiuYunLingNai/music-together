import WebSocket from 'ws'

const port = Number(process.env.MT_ELECTRON_DEBUG_PORT || 9223)
const serverUrl = process.env.MT_SERVER_URL || 'https://0music.qqun.top:9872'
const deadlineMs = 20_000

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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Electron evaluation failed')
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
  const body = await cdp.evaluate(`document.body?.innerText?.slice(0, 500) || ''`)
  throw new Error(`timeout waiting for ${label}; page: ${body}`)
}

const instrumentation = `(() => {
  const NativeAudio = window.Audio;
  function CapturedAudio(...args) {
    const audio = new NativeAudio(...args);
    window.__mtSmokeAudio = audio;
    return audio;
  }
  CapturedAudio.prototype = NativeAudio.prototype;
  window.Audio = CapturedAudio;

  const NativeWebSocket = window.WebSocket;
  window.__mtSmokeSent = [];
  function CapturedWebSocket(...args) {
    const socket = new NativeWebSocket(...args);
    window.__mtSmokeSocket = socket;
    const nativeSend = socket.send.bind(socket);
    socket.send = (raw) => {
      try { window.__mtSmokeSent.push(JSON.parse(String(raw))); } catch {}
      return nativeSend(raw);
    };
    return socket;
  }
  CapturedWebSocket.prototype = NativeWebSocket.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Object.defineProperty(CapturedWebSocket, key, { value: NativeWebSocket[key] });
  window.WebSocket = CapturedWebSocket;
})();`

async function main() {
  const target = await waitForTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  try {
    await cdp.open()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation })
    await cdp.send('Page.reload', { ignoreCache: true })
    await poll(cdp, `Boolean(document.querySelector("input[aria-label='服务器地址']") && window.__mtSmokeAudio)`, 'instrumented app load')

    const nickname = `Electron-QA-${Date.now().toString(36).slice(-5)}`
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
    const lobbyText = await poll(cdp, `document.querySelector('.stage-heading')?.innerText || ''`, 'online lobby')
    const lobbyCards = await cdp.evaluate(`document.querySelectorAll('.lobby-room').length`)
    assert(lobbyText.includes('选择一个房间'), 'online lobby heading missing')
    console.log(`OK Electron identity cookie and lobby: ${lobbyCards} public room(s)`)

    await cdp.evaluate(`document.querySelector("button[title='创建房间']").click()`)
    await poll(cdp, `Boolean(document.querySelector('.create-room'))`, 'create-room form')
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.create-room input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(`Electron Smoke ${Date.now().toString().slice(-6)}`)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.create-room').requestSubmit();
      return true;
    })()`)
    await poll(cdp, `Boolean(document.querySelector('.room-panel') && document.querySelector('.transport'))`, 'created room')
    console.log('OK Electron room creation and owner session')

    await cdp.evaluate(`document.querySelector(".now-playing__actions button[title='搜索并点歌']").click()`)
    await poll(cdp, `Boolean(document.querySelector('.search-dialog'))`, 'search dialog')
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search-form input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '晴天');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.search-form').requestSubmit();
      return true;
    })()`)
    await poll(cdp, `document.querySelectorAll(".search-result button[title='加入队列']").length >= 2`, 'online search results', 30_000)
    await cdp.evaluate(`(() => {
      const buttons = document.querySelectorAll(".search-result button[title='加入队列']");
      buttons[0].click();
      buttons[1].click();
      return buttons.length;
    })()`)
    await cdp.evaluate(`document.querySelector(".search-dialog button[title='关闭']").click()`)
    const firstTitle = await poll(cdp, `(() => { const text = document.querySelector('.transport-track strong')?.textContent || ''; return text && text !== '尚未播放' ? text : ''; })()`, 'first track playback', 30_000)
    await poll(cdp, `document.querySelectorAll('.queue-item').length >= 2`, 'two queued tracks', 30_000)
    console.log(`OK Electron online search, queue, and playback: ${firstTitle}`)

    const sentBefore = await cdp.evaluate(`window.__mtSmokeSent.filter((message) => message.event === 'player:next').length`)
    await cdp.evaluate(`(() => {
      window.__mtSmokeAudio.dispatchEvent(new Event('ended'));
      window.__mtSmokeAudio.dispatchEvent(new Event('ended'));
      return true;
    })()`)
    const nextCount = await poll(cdp, `(() => { const count = window.__mtSmokeSent.filter((message) => message.event === 'player:next').length - ${sentBefore}; return count > 0 ? count : 0; })()`, 'automatic PLAYER_NEXT')
    assert(nextCount === 1, `natural end emitted PLAYER_NEXT ${nextCount} times`)
    const secondTitle = await poll(cdp, `(() => { const text = document.querySelector('.transport-track strong')?.textContent || ''; return text && text !== ${JSON.stringify(firstTitle)} ? text : ''; })()`, 'automatic next track', 30_000)
    assert(secondTitle !== firstTitle, 'automatic next did not change the current track')
    console.log(`OK Electron host natural-end auto-next exactly once: ${secondTitle}`)

    const sentNextTotal = await cdp.evaluate(`window.__mtSmokeSent.filter((message) => message.event === 'player:next').length`)
    const identityBootstrapCalls = await cdp.evaluate(`window.__mtSmokeSent.filter((message) => message.event === 'room:create').length`)
    assert(sentNextTotal >= 1 && identityBootstrapCalls === 1, 'unexpected Electron protocol counts')
    await cdp.evaluate(`window.__mtSmokeSocket.send(JSON.stringify({ event: 'room:leave' }))`)
    console.log('ELECTRON_SMOKE_OK')
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`ELECTRON_SMOKE_FAILED: ${error.message}`)
  process.exitCode = 1
})
