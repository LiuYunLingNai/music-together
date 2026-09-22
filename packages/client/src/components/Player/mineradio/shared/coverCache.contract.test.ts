import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：封面缓存的两个真实缺陷。
 *
 * ① **失败加载被永久缓存**：`image.onerror` 只 `resolve(null)`，不摘除
 *    `cache` 里的条目 —— 那个 URL 从此被"投毒"，之后所有 `loadCoverAssets`
 *    都立刻命中它拿到 null。瞬时网络抖动就会让这首歌的封面 / 调色板 /
 *    accent 在本会话内**永不恢复**（只能刷新页面）。
 *
 * ② **无界增长**：另有一个 `resolved: Map<string, CoverAssets>` 只写不清理，
 *    LRU 只作用于 `cache`。每条 = 解码图 + 256×256 RGBA canvas（约 256KB），
 *    随每个新封面 URL 无界增长 —— 注释却写"防止长时间连续切歌无限增长"，
 *    与实际行为相反。其唯一读取者 `peekResolvedCoverAssets` 全仓零调用方。
 *
 * 本测试读源码做结构断言（模块级缓存无法在单测里安全地跑真实图片加载）。
 */
const SOURCE = readFileSync(join(__dirname, 'CoverTextureLoader.ts'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('封面缓存契约', () => {
  const body = stripComments(SOURCE)

  it('加载失败必须从 cache 摘除条目（否则该 URL 被永久投毒）', () => {
    const onerror = body.match(/image\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\s{4}\}/)
    expect(onerror, 'image.onerror 未找到').toBeTruthy()
    // 必须调用 cache.delete
    expect(onerror![0], 'onerror 里必须 cache.delete(proxied)').toMatch(/cache\.delete\(proxied\)/)
  })

  it('只保留一份缓存（不得再有只写不清理的 resolved map）', () => {
    // `resolved` 曾在注释里被解释；代码里不得再出现这个标识符
    expect(body, 'resolved map 已移除，不应复活').not.toMatch(/\bresolved\b/)
    // 死导出也必须一并移除（否则又会有人接上一个无界 map）
    expect(body).not.toMatch(/peekResolvedCoverAssets/)
  })

  it('LRU 上限仍然存在且作用于唯一的缓存', () => {
    expect(body).toMatch(/MAX_CACHE\s*=\s*\d+/)
    expect(body).toMatch(/while\s*\(cache\.size\s*>\s*MAX_CACHE\)/)
  })

  it('clearCoverCache 清空缓存（舞台卸载时调用）', () => {
    const fn = body.match(/export function clearCoverCache[\s\S]*?\n\}/)
    expect(fn).toBeTruthy()
    expect(fn![0]).toMatch(/cache\.clear\(\)/)
  })
})
