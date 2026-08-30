import Config from "../../components/Config.js"

export const schemas = [
  { component: "Divider", label: "服务端" },
  {
    field: "server.baseUrl",
    label: "Music Together 地址",
    component: "Input",
    required: true,
    placeholder: "http://127.0.0.1:3001",
  },
  {
    field: "server.wsUrl",
    label: "WebSocket 地址",
    component: "Input",
    placeholder: "留空则根据服务端地址推导",
  },
  {
    field: "server.requestTimeout",
    label: "请求超时（毫秒）",
    component: "InputNumber",
    min: 1000,
    max: 120000,
    step: 1000,
  },
  { component: "Divider", label: "房间与音乐" },
  { field: "room.nickname", label: "默认房间昵称", component: "Input", required: true },
  { field: "room.defaultRoomName", label: "默认房间名", component: "Input" },
  { field: "room.autoRejoin", label: "断线自动重连", component: "Switch" },
  {
    field: "music.defaultSource",
    label: "默认音源",
    component: "Select",
    options: [
      { label: "网易云", value: "netease" },
      { label: "QQ音乐", value: "tencent" },
      { label: "酷狗", value: "kugou" },
      { label: "酷狗概念版", value: "kugou_concept" },
      { label: "哔哩哔哩", value: "bilibili" },
    ],
  },
  {
    field: "music.searchLimit",
    label: "搜索结果数量",
    component: "InputNumber",
    min: 1,
    max: 50,
    step: 1,
  },
  { component: "Divider", label: "群聊权限与转发" },
  { field: "permission.bindMasterOnly", label: "绑定/解绑仅限主人", component: "Switch" },
  {
    field: "permission.authMasterOnly",
    label: "群内账号登录仅限主人",
    component: "Switch",
  },
  { field: "permission.controlGroupAdmin", label: "播放控制需要群管理", component: "Switch" },
  { field: "chat.roomToGroup", label: "房间聊天转发到群", component: "Switch" },
  { field: "chat.notifyUserChange", label: "转发成员进出通知", component: "Switch" },
  { field: "chat.notifyTrackChange", label: "转发歌曲切换通知", component: "Switch" },
]

export function getConfigData() {
  return Config.all
}

export function setConfigData(data, { Result }) {
  const updates = []
  const flatten = (value, prefix = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      updates.push({ key: prefix, value })
      return
    }
    for (const [key, child] of Object.entries(value))
      flatten(child, prefix ? `${prefix}.${key}` : key)
  }
  flatten(data)
  Config.setConfigs(updates)
  return Result.ok({}, "保存成功")
}
