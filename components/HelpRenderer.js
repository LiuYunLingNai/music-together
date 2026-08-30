import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import path from "node:path"

const templateFile = path.join(
  process.cwd(),
  "plugins",
  "music-together-plugin",
  "resources",
  "help",
  "index.html",
)

const helpGroups = [
  {
    name: "房间",
    items: [
      ["创建 [房间名] [密码]", "创建并绑定听歌房间"],
      ["加入 <房间号> [密码]", "加入已有听歌房间"],
      ["绑定 <房间号> [密码]", "绑定群与房间"],
      ["解绑", "解除当前群房间绑定"],
      ["分享 / 二维码", "分享房间邀请信息"],
      ["退出", "退出当前听歌房间"],
    ],
  },
  {
    name: "音乐",
    items: [
      ["搜索 [音源] <关键词>", "搜索歌曲并生成结果图片"],
      ["热歌 [音源]", "查看音源热歌榜"],
      ["推荐", "获取 Music Together 推荐"],
      ["歌单 <音源> <歌单ID>", "将歌单加入播放队列"],
      ["点歌 <序号>", "将搜索结果加入队列"],
      ["当前歌曲 / 发歌", "发送当前歌曲、封面和音频"],
    ],
  },
  {
    name: "播放控制",
    items: [
      ["列表 / 队列", "查看当前播放列表"],
      ["状态", "查看房间和播放状态"],
      ["暂停 / 继续", "暂停或恢复播放"],
      ["上一首 / 下一首", "切换播放歌曲"],
      ["模式 <顺序|列表循环|单曲循环|随机>", "切换播放模式"],
      ["聊天 <内容>", "向听歌房间发送聊天"],
    ],
  },
  {
    name: "账号与推送",
    items: [
      ["登录 <账号ID> <密码>", "私聊登录，每个QQ独立保存"],
      ["推送 开启 / 关闭 / 状态", "管理当前群实时推送"],
      ["推送格式 <图文|图片>", "选择歌曲信息推送样式"],
      ["推送音频 <开启|关闭>", "选择是否发送歌曲音频"],
      ["更新 / 升级", "更新插件代码（仅主人）"],
    ],
  },
]

export async function renderHelp() {
  try {
    return await puppeteer.screenshot("music-together-plugin/help", {
      tplFile: templateFile,
      saveId: "index",
      title: "Music Together 一起听歌",
      subtitle: "群聊同步听歌插件使用指南",
      groups: helpGroups,
    })
  } catch (error) {
    if (typeof logger !== "undefined")
      logger.debug?.(`[Music Together] 帮助图渲染失败：${error.message}`)
    return false
  }
}
