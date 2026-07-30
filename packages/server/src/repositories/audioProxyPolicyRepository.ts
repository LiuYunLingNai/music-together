import type { AudioProxyPolicy } from '@music-together/shared'
import { db } from './database.js'

const POLICY_KEY = 'audio_proxy_policy'

export const DEFAULT_AUDIO_PROXY_POLICY: Readonly<AudioProxyPolicy> = Object.freeze({
  bilibiliForceProxy: true,
  kugouForceProxy: true,
})

interface ServerSettingRow {
  value_json: string
}

const selectPolicy = db.prepare<[string], ServerSettingRow>('SELECT value_json FROM server_settings WHERE key = ?')
const upsertPolicy = db.prepare(`
  INSERT INTO server_settings (key, value_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`)

function parsePolicy(value: string | undefined): AudioProxyPolicy {
  if (!value) return { ...DEFAULT_AUDIO_PROXY_POLICY }
  try {
    const parsed = JSON.parse(value) as Partial<AudioProxyPolicy>
    return {
      bilibiliForceProxy:
        typeof parsed.bilibiliForceProxy === 'boolean'
          ? parsed.bilibiliForceProxy
          : DEFAULT_AUDIO_PROXY_POLICY.bilibiliForceProxy,
      kugouForceProxy:
        typeof parsed.kugouForceProxy === 'boolean'
          ? parsed.kugouForceProxy
          : DEFAULT_AUDIO_PROXY_POLICY.kugouForceProxy,
    }
  } catch {
    return { ...DEFAULT_AUDIO_PROXY_POLICY }
  }
}

export const audioProxyPolicyRepo = {
  get(): AudioProxyPolicy {
    return parsePolicy(selectPolicy.get(POLICY_KEY)?.value_json)
  },

  update(patch: Partial<AudioProxyPolicy>): AudioProxyPolicy {
    const policy = { ...this.get(), ...patch }
    upsertPolicy.run(POLICY_KEY, JSON.stringify(policy), Date.now())
    return policy
  },
}
