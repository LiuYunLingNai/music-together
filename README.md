# music-together-plugin

将 TRSS-Yunzai 群聊连接到 [Music Together](https://github.com/LiuYunLingNai/music-together) 同步听歌房间。

## 安装

在 TRSS-Yunzai 根目录执行：

```bash
git clone -b yunzai-plugin https://github.com/LiuYunLingNai/music-together.git ./plugins/music-together-plugin
```

安装或更新后重启 TRSS-Yunzai。插件默认连接 `http://127.0.0.1:3001`，可在锅巴配置页或 `config/config/config.yaml` 中修改 Music Together 服务地址。

## 常用命令

```text
#一起听歌帮助
#一起听歌创建 [房间名] [密码]
#一起听歌加入 <房间号> [密码]
#一起听歌登录 <账号ID> <密码>（私聊登录，每个QQ独立保存）
#一起听歌搜索 [音源] <关键词>
#一起听歌点歌 <序号>
#一起听歌发歌
#一起听歌聊天 <内容>
#一起听歌推送 <开启|关闭|状态>
#一起听歌推送格式 <图文|图片>
#一起听歌推送音频 <开启|关闭>
#一起听歌更新
#一起听歌更新日志
#一起听歌状态
#一起听歌列表
#一起听歌分享
#一起听歌退出
```

`#一起听歌发歌` 会发送当前歌曲信息、封面和音频。开启群推送后，插件会实时转发播放歌曲信息、封面、音频和房间聊天。

主人可以发送 `#一起听歌更新` 从 `yunzai-plugin` 分支更新插件，或发送 `#一起听歌更新日志` 查看提交记录；更新成功后请重启 Yunzai。

推送样式和是否发送音频按群保存。默认发送图文和音频，可用 `#一起听歌推送格式 图片` 切换为纯图片，用 `#一起听歌推送音频 关闭` 停止发送音频。

账号身份会按 QQ 用户分别保存；群内登录会将当前群切换到该账号，私聊登录不会改变其他用户的账号。房间密码和群绑定保存在 `config/config/`，该目录不会提交到 Git。
