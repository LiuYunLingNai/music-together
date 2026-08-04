# Music Together Windows v2.2.7

## 修复

- 修复自动更新未识别 CI 构建安装包名称的问题。
- 正式 Release 现在统一使用更新器可识别的 NSIS 安装包名称，并保留 SHA-256 校验文件。
- 更新检查兼容旧版与新版安装包命名，确保可稳定发现后续 Windows 更新。
- 更新弹窗现在会显示 GitHub Release 中的更新日志。
- 下载更新前可选择 GitHub 直连或 ghfast.top 代理，安装包与校验文件始终使用同一下载源。

## 发布内容

- Windows NSIS 安装包
- Windows Portable 便携版
- 安装包 blockmap 更新文件
- SHA-256 校验文件
