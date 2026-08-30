import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import chokidar from "chokidar"
import lodash from "lodash"
import { Plugin_Path, Log_Prefix } from "./Constants.js"

/**
 * 极简 YAML 读写器，保留注释
 */
class YamlReader {
  constructor(yamlPath) {
    this.yamlPath = yamlPath
    this.reload()
  }

  reload() {
    this.document = YAML.parseDocument(fs.readFileSync(this.yamlPath, "utf8"))
  }

  get jsonData() {
    return this.document?.toJSON()
  }

  get(key) {
    return this.document.getIn(key.split("."))
  }

  set(key, value) {
    this.document.setIn(key.split("."), value)
    this.save()
  }

  delete(key) {
    this.document.deleteIn(key.split("."))
    this.save()
  }

  save() {
    fs.writeFileSync(this.yamlPath, this.document.toString(), "utf8")
  }
}

class Config {
  constructor() {
    /** @type {Record<string, any>} 配置缓存 */
    this.config = {}
    /** @type {Record<string, any>} 文件监听器 */
    this.watcher = {}
    this.initCfg()
  }

  /** 初始化用户配置目录，把缺失的默认配置复制过去 */
  initCfg() {
    const configPath = path.join(Plugin_Path, "config", "config")
    const defPath = path.join(Plugin_Path, "config", "default_config")
    if (!fs.existsSync(configPath)) fs.mkdirSync(configPath, { recursive: true })

    const files = fs.readdirSync(defPath).filter(file => file.endsWith(".yaml"))
    for (const file of files) {
      const target = path.join(configPath, file)
      if (!fs.existsSync(target)) {
        fs.copyFileSync(path.join(defPath, file), target)
      }
      this.watch(target, file.replace(".yaml", ""), "config")
    }
  }

  /** 服务端配置 */
  get server() {
    return this.getDefOrConfig("config").server ?? {}
  }

  /** 房间配置 */
  get room() {
    return this.getDefOrConfig("config").room ?? {}
  }

  /** 音乐配置 */
  get music() {
    return this.getDefOrConfig("config").music ?? {}
  }

  /** 聊天转发配置 */
  get chat() {
    return this.getDefOrConfig("config").chat ?? {}
  }

  /** 渲染配置 */
  get render() {
    return this.getDefOrConfig("config").render ?? {}
  }

  /** 权限配置 */
  get permission() {
    return this.getDefOrConfig("config").permission ?? {}
  }

  /** 其他配置 */
  get other() {
    return this.getDefOrConfig("config").other ?? {}
  }

  /** 完整配置（Guoba 用） */
  get all() {
    return this.getDefOrConfig("config")
  }

  /** 群房间绑定表 */
  get bindings() {
    return this.getDefOrConfig("binding").bindings ?? {}
  }

  /** Music Together 身份缓存 */
  get auth() {
    return this.getDefOrConfig("auth").identity ?? {}
  }

  /**
   * 合并默认配置与用户配置
   * @param {string} name 配置文件名
   */
  getDefOrConfig(name) {
    const def = this.getYaml("default_config", name)
    const user = this.getYaml("config", name)
    return lodash.mergeWith({}, def, user, (objValue, srcValue) => {
      if (lodash.isArray(objValue)) return srcValue
    })
  }

  /**
   * 读取 YAML 并缓存
   * @param {'default_config'|'config'} type
   * @param {string} name
   */
  getYaml(type, name) {
    const file = path.join(Plugin_Path, "config", type, `${name}.yaml`)
    const key = `${type}.${name}`
    if (this.config[key]) return this.config[key]
    if (!fs.existsSync(file)) return {}

    this.config[key] = YAML.parse(fs.readFileSync(file, "utf8")) ?? {}
    this.watch(file, name, type)
    return this.config[key]
  }

  /**
   * 监听配置文件变更，热重载
   * @param {string} file
   * @param {string} name
   * @param {'default_config'|'config'} type
   */
  watch(file, name, type = "default_config") {
    const key = `${type}.${name}`
    if (this.watcher[key]) return

    const watcher = chokidar.watch(file)
    watcher.on("change", () => {
      delete this.config[key]
      if (typeof logger === "undefined") return
      logger.mark(`${Log_Prefix}[修改配置文件][${type}][${name}]`)
    })
    this.watcher[key] = watcher
  }

  /**
   * 修改用户配置
   * @param {string} name 配置文件名
   * @param {string} key 点分路径
   * @param {any} value 值
   */
  modify(name, key, value) {
    const file = path.join(Plugin_Path, "config", "config", `${name}.yaml`)
    if (!fs.existsSync(file)) {
      fs.copyFileSync(path.join(Plugin_Path, "config", "default_config", `${name}.yaml`), file)
    }
    new YamlReader(file).set(key, value)
    delete this.config[`config.${name}`]
    return true
  }

  /**
   * 删除用户配置项
   * @param {string} name
   * @param {string} key
   */
  deleteKey(name, key) {
    const file = path.join(Plugin_Path, "config", "config", `${name}.yaml`)
    if (!fs.existsSync(file)) return false
    new YamlReader(file).delete(key)
    delete this.config[`config.${name}`]
    return true
  }

  /**
   * 批量修改（Guoba 保存用）
   * @param {Array<{key: string, value: any}>} data
   * @param {string} name
   */
  setConfigs(data, name = "config") {
    const file = path.join(Plugin_Path, "config", "config", `${name}.yaml`)
    if (!fs.existsSync(file)) {
      fs.copyFileSync(path.join(Plugin_Path, "config", "default_config", `${name}.yaml`), file)
    }
    const reader = new YamlReader(file)
    for (const item of data) {
      reader.document.setIn(item.key.split("."), item.value)
    }
    reader.save()
    delete this.config[`config.${name}`]
    return true
  }

  /**
   * 绑定群与房间
   * @param {string} groupKey 群标识
   * @param {object} info 绑定信息
   */
  setBinding(groupKey, info) {
    return this.modify("binding", `bindings.${groupKey}`, info)
  }

  /**
   * 解绑群
   * @param {string} groupKey
   */
  removeBinding(groupKey) {
    return this.deleteKey("binding", `bindings.${groupKey}`)
  }

  /**
   * 获取绑定信息
   * @param {string} groupKey
   */
  getBinding(groupKey) {
    return this.bindings?.[groupKey]
  }

  /**
   * 保存 Music Together 身份，不保存账号密码。
   * @param {object} identity
   */
  setAuth(identity) {
    return this.setConfigs(
      [
        { key: "identity.token", value: identity.token || "" },
        { key: "identity.userId", value: identity.userId || "" },
        { key: "identity.expiresAt", value: Number(identity.expiresAt) || 0 },
        { key: "identity.profile", value: identity.profile || null },
      ],
      "auth",
    )
  }

  clearAuth() {
    return this.setAuth({})
  }
}

export { YamlReader }
export default new Config()
