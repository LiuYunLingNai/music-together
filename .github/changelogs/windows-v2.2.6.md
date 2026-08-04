# Music Together Windows v2.2.6

## 新增与改进

- 新增独立的“应用更新”入口，位于标题栏，无需连接服务器或进入房间即可检查更新。
- 支持从 Windows 专属 Release 检查新版本、下载 NSIS 安装包、校验 SHA-256，并在确认后重启安装。
- 发现新版本、下载进度、安装就绪和失败重试均会提供明确提示。
- 测试构建提供调试日志导出，便于收集问题信息；正式版不显示该入口。

## 构建与发布

- Windows CI 会在每次代码推送时生成 Debug 测试包。
- 正式版使用独立构建流程，Windows 与 Android Release 标签保持隔离。

## 发布内容

- Windows NSIS 安装包
- Windows Portable 便携版
- 安装包 blockmap 更新文件
- SHA-256 校验文件
