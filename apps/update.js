import plugin from "../../../lib/plugins/plugin.js"
import { Plugin_Path } from "../components/Constants.js"

let updating = false

function cleanGitOutput(value) {
  return String(value || "").replace(/https?:\/\/[^\s/@]+@/gi, "https://")
}

/** 独立的一起听歌插件更新命令，避免和听歌业务命令耦合。 */
export class MusicTogetherUpdate extends plugin {
  constructor() {
    super({
      name: "一起听歌更新",
      dsc: "更新 Music Together Yunzai 插件",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^#?(?:一起听歌|音乐同听)(?:更新|升级)$",
          fnc: "update",
          log: false,
        },
      ],
    })
  }

  async update(e) {
    if (!e.isMaster) return this.reply("只有主人可以更新一起听歌插件")
    if (updating) return this.reply("一起听歌插件正在更新，请稍候再试")

    updating = true
    try {
      const branch = await Bot.exec("git branch --show-current", {
        cwd: Plugin_Path,
        quiet: true,
      })
      if (branch.error) return this.reply("更新失败：当前插件目录不是 Git 仓库")

      const currentBranch = branch.stdout.trim()
      if (currentBranch !== "yunzai-plugin")
        return this.reply(`更新失败：当前分支为 ${currentBranch || "未知"}，需要 yunzai-plugin`)

      const status = await Bot.exec("git status --porcelain --untracked-files=no", {
        cwd: Plugin_Path,
        quiet: true,
      })
      if (status.error) return this.reply("更新失败：无法检查插件目录状态")
      if (status.stdout.trim()) return this.reply("更新已取消：插件目录有未提交修改，请先手动处理")

      const result = await Bot.exec("git pull --ff-only origin yunzai-plugin", {
        cwd: Plugin_Path,
        quiet: true,
      })
      if (result.error) {
        logger.warn(`${Log_Prefix} 插件更新失败：${cleanGitOutput(result.stderr || result.stdout)}`)
        return this.reply("更新失败：无法快进到远端 yunzai-plugin，请检查网络或手动更新")
      }
      if (/Already up.to.date|已经是最新/i.test(result.stdout))
        return this.reply("✅ 一起听歌插件已经是最新版本")
      return this.reply("✅ 一起听歌插件更新成功，请重启 Yunzai 使新代码生效")
    } finally {
      updating = false
    }
  }
}

export default MusicTogetherUpdate
