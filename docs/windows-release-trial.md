# FakeClaw 正式试用版安装说明

## 前置条件

- Windows 10 / 11
- Node.js 22 或更高版本
- 已允许本机读取 Windows 通知
- 如需 QQ / NapCat 接入：请先自行安装 NapCat，并准备本机启动脚本路径

## 安装结果

安装完成后：

- 程序文件默认安装到 `C:\Program Files\FakeClaw`
- 用户配置与可写数据默认写入 `%LOCALAPPDATA%\FakeClaw`
- 开始菜单会创建 FakeClaw 托盘启动入口
- 安装器不会自动安装 NapCat、Telegram、飞书或企业微信机器人环境

## 首次启动

1. 从开始菜单或桌面快捷方式启动 FakeClaw。
2. 托盘首次运行会默认处于“未配置 / 无机器人”状态。
3. 双击托盘图标打开配置窗口。
4. 如只使用本地通知转发与校准功能，可继续保持“未配置 / 无机器人”。
5. 如需接入机器人平台，再切换到对应平台并填写配置。

## NapCat 说明

- 正式试用版不内置 NapCat。
- 如果要启用 QQ / NapCat，请先在本机完成 NapCat 安装。
- 然后在 FakeClaw 配置页中填写：
  - `NAPCAT_WS_URL`
  - `NAPCAT_TOKEN`
  - `NAPCAT_START_SCRIPT`
  - `QQ_USER_ID`

## 常见问题

### 安装器提示缺少 Node.js

FakeClaw 正式版不会自带 Node 运行时。请先安装 Node.js 22+，再重新运行安装器。

### 配置保存失败

正式版不会把 `.env` 写到安装目录，而是写到 `%LOCALAPPDATA%\FakeClaw\.env`。若仍失败，请确认当前用户对自己的本地用户目录有写权限。

### 校准配置保存在哪里

桌面自动化校准配置默认保存到：

`%LOCALAPPDATA%\FakeClaw\config\desktop-automation.config.json`

### 卸载后配置是否保留

卸载程序默认不会删除 `%LOCALAPPDATA%\FakeClaw`，这样可以保留你的配置和截图记录。
