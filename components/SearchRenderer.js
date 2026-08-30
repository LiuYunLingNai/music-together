import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import path from "node:path"

const templateFile = path.join(
  process.cwd(),
  "plugins",
  "music-together-plugin",
  "resources",
  "search",
  "index.html",
)

/**
 * 将搜索结果渲染为图片消息。
 * 渲染器或浏览器不可用时返回 false，由调用方回退为文字消息。
 */
export async function renderSearchResults({ title, subtitle, tracks }) {
  try {
    return await puppeteer.screenshot("music-together-plugin/search", {
      tplFile: templateFile,
      saveId: `search-${Date.now()}`,
      title: String(title || "Music Together"),
      subtitle: String(subtitle || ""),
      tracks: (tracks || []).slice(0, 30),
    })
  } catch (error) {
    if (typeof logger !== "undefined")
      logger.debug?.(`[Music Together] 搜索结果图片渲染失败：${error.message}`)
    return false
  }
}
