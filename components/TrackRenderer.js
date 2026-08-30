import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import path from "node:path"
import { SOURCE_NAMES } from "./Constants.js"

const templateFile = path.join(
  process.cwd(),
  "plugins",
  "music-together-plugin",
  "resources",
  "track",
  "index.html",
)

/** 将单首歌曲渲染成用于群推送的图片卡片。 */
export async function renderTrackCard(track, options = {}) {
  try {
    const artists = Array.isArray(track.artist)
      ? track.artist.join("、")
      : String(track.artist || "未知歌手")
    return await puppeteer.screenshot("music-together-plugin/track", {
      tplFile: templateFile,
      saveId: `track-${String(track.id || Date.now())}`,
      track: {
        title: String(track.title || "未知歌曲"),
        artist: artists,
        album: String(track.album || "未知专辑"),
        cover: String(track.cover || track.thumbnailCover || ""),
        source: SOURCE_NAMES[track.source] || track.source || "未知音源",
        duration: formatDuration(track.duration),
        roomName: String(options.roomName || "Music Together 房间"),
        listenerText: options.listenerCount
          ? `${Number(options.listenerCount)} 人正在一起听`
          : "一起听歌",
      },
    })
  } catch (error) {
    if (typeof logger !== "undefined")
      logger.debug?.(`[Music Together] 歌曲推送卡片渲染失败：${error.message}`)
    return false
  }
}

function formatDuration(value) {
  const seconds = Number(value) || 0
  if (seconds <= 0) return ""
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}
