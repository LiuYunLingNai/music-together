import plugin from "../../../lib/plugins/plugin.js"
import { update as Update } from "../../other/update.js"

const Plugin_Name = "music-together-plugin"

/** 复用 Yunzai 通用更新器，提供一起听歌插件更新与更新日志。 */
export class MusicTogetherUpdate extends plugin {
  constructor() {
    super({
      name: "一起听歌更新",
      dsc: "更新 Music Together Yunzai 插件",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^#?(?:一起听歌|音乐同听)(?:插件)?(?:强制)?更新$",
          fnc: "update",
          log: false,
        },
        {
          reg: "^#?(?:一起听歌|音乐同听)(?:插件)?更新日志$",
          fnc: "updateLog",
          log: false,
        },
      ],
    })
  }

  async update(e = this.e) {
    if (!e?.isMaster) return this.reply("只有主人可以更新一起听歌插件")
    e.msg = `#${e.msg?.includes("强制") ? "强制" : ""}更新${Plugin_Name}`
    const updater = new Update(e)
    updater.e = e
    return updater.update()
  }

  async updateLog(e = this.e) {
    const updater = new Update()
    updater.e = e
    if (await updater.getPlugin(Plugin_Name)) return this.reply(await updater.getLog(Plugin_Name))
    return this.reply("未找到一起听歌插件 Git 仓库")
  }
}

export default MusicTogetherUpdate
