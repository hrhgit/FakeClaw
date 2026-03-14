# FakeClaw

一个运行在 Windows 上的无 token 消耗、轻部署的自动化工具，功能是多平台消息通知转发器和这台电脑上多种 IDE 的远程操作桥。

原理是服务常驻本机，负责监听系统通知和私聊命令，再通过消息平台转发与本地桌面自动化完成 IDE 操作及结果回传。

当前支持 `NapCat / QQ`、`Telegram`、`飞书`、`企业微信` 作为消息入口。

快速入口：[快速开始](#快速开始) | [消息平台](#消息平台) | [远程命令](#远程命令) | [校准与兼容性](#校准与兼容性) | [环境变量](#环境变量)

## 主要功能

- 把这台 Windows 机器上的 **IDE、终端和桌面应用通知** 转发到指定消息平台私聊，方便在离开电脑时继续看本机动静
- 通过私聊 **远程拉起本机 IDE**，切换到目标窗口，并把提示词粘贴到聊天输入区
- 支持按需 只粘贴不发送，适合先远程准备提示词、再回到电脑上手动确认
- 每次自动化任务结束后都会 **回传执行结果和桌面截图**，方便确认到底有没有命中正确窗口和输入区
- 支持通过 **统一配置、校准脚本和本地校准网页** 修正不同机器、不同分辨率、不同 IDE 布局下的输入框定位问题

## 本次更新

- 新增统一消息平台抽象，可在 `NapCat / QQ`、`Telegram`、`飞书`、`企业微信` 之间切换
- 新增 `start-qq.bat`、`start-telegram.bat`、`start-feishu.bat`、`start-wecom.bat` 启动入口
- 扩展 `.env.example`，补齐各平台机器人、回调地址和鉴权相关配置
- 新增 [docs/messaging-platforms.md](./docs/messaging-platforms.md)，汇总各平台接入说明
- 远程操作目标从原先的少数桌面应用扩展到 `Codex / Cursor / Trae / Trae CN / CodeBuddy / CodeBuddy CN / Antigravity`
- 统一了桌面自动化配置，布局阈值集中放在 [config/desktop-automation.config.json](./config/desktop-automation.config.json)
- 新增桌面校准脚本和批处理入口，方便在不同机器上重新标定输入框位置
- 新增本地校准网页，可在浏览器里分析候选输入区、试跑草稿配置并保存

## 消息平台

支持的平台与入口：

- `NapCat / QQ`: 默认模式，使用 WebSocket 收发消息，`start-qq.bat` 会先拉起 NapCat 再启动服务
- `Telegram`: 使用 Bot API 长轮询收发私聊消息，启动入口为 `start-telegram.bat`
- `飞书`: 使用事件订阅回调接收私聊文本命令，启动入口为 `start-feishu.bat`
- `企业微信`: 使用自建应用回调接收命令并回发消息，启动入口为 `start-wecom.bat`

通用规则：

- 通过 `BOT_PLATFORM` 选择当前消息平台，默认值为 `napcat`
- 各平台都复用同一套 `/help`、`/status`、`/shot` 和 IDE 自动化命令
- 当前选中平台对应的授权用户会同时作为通知接收方和远程命令执行者

更详细的接入字段、回调地址和公网要求见 [docs/messaging-platforms.md](./docs/messaging-platforms.md)。

## IDE 支持矩阵

| IDE | 通知转发 | 远程操作 | 支持程度 / 备注 |
| --- | --- | --- | --- |
| Codex | 支持 | `open / focus / paste / send / screenshot` | 相对稳定 |
| Cursor | 支持 | `open / focus / paste / send / screenshot` | 可用，建议校准后使用 |
| Trae | 支持 | `open / focus / paste / send / screenshot` | 可用，建议校准后使用 |
| Antigravity | 支持 | `open / focus / paste / send / screenshot` | 可用，建议校准后使用 |
| CodeBuddy | 支持 | `open / focus / paste / send / screenshot` | 适配一般，依赖布局与兜底点击，建议保守使用 |
| VS Code | 支持 | 不支持 | 仅通知转发 |
| Windsurf | 支持 | 不支持 | 仅通知转发 |
| Kiro | 支持 | 不支持 | 仅通知转发 |
| JetBrains IDEs | 支持 | 不支持 | 仅通知转发，含 AI Assistant / Junie 及宿主 IDE |
| Zed | 支持 | 不支持 | 仅通知转发 |
| PowerShell | 支持 | 不支持 | 仅通知转发 |

补充说明：

- `Trae CN` 共享 `Trae` 的远程自动化能力与校准配置，命令目标为 `traecn`
- `CodeBuddy CN` 共享 `CodeBuddy` 的远程自动化能力与校准配置，命令目标为 `codebuddycn`
- 所有远程自动化任务都会串行执行；忙碌时会直接拒绝，不排队

## 快速开始

### 依赖

- Windows
- Node.js 22+
- 已授予 Windows 通知读取权限
- 已在需要转发的 IDE 或桌面应用里开启系统通知，至少要允许横幅或通知中心提示

按平台补充：

- `NapCat / QQ` 模式需要本机已安装并登录 NapCat
- `Telegram` 模式需要可用的 Bot Token 和私聊 Chat ID
- `飞书` / `企业微信` 模式需要本机或代理可接收平台事件回调

NapCat 项目：

- [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [Windows Releases](https://github.com/NapNeko/NapCatQQ/releases)

### 安装与初始化

```powershell
npm install
Copy-Item .env.example .env
```

至少需要配置：

- `BOT_PLATFORM`
- 你准备远程操作的 IDE 对应 `*_LAUNCH_COMMAND`

按平台至少再补充：

- `napcat`: `NAPCAT_TOKEN`、`NAPCAT_START_SCRIPT`、`QQ_USER_ID`
- `telegram`: `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
- `feishu`: `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_OPEN_ID`、`FEISHU_VERIFICATION_TOKEN`
- `wecom`: `WECOM_CORP_ID`、`WECOM_CORP_SECRET`、`WECOM_AGENT_ID`、`WECOM_USER_ID`、`WECOM_TOKEN`、`WECOM_ENCODING_AES_KEY`

### 启动方式

只启动转发服务：

```powershell
start-app.bat
```

按平台启动：

```powershell
start-qq.bat
start-telegram.bat
start-feishu.bat
start-wecom.bat
```

说明：

- `start-qq.bat` 会先启动 NapCat，再启动转发服务
- 其他平台脚本只启动转发服务，并在脚本内设置对应 `BOT_PLATFORM`

开发模式：

```powershell
npm run dev
```

## 环境变量

以下变量以 [.env.example](./.env.example) 为准。

### 核心连接

- `BOT_PLATFORM`: 当前消息平台，支持 `napcat | telegram | feishu | wecom`
- `NAPCAT_WS_URL`: NapCat WebSocket 地址，默认 `ws://127.0.0.1:3001`
- `NAPCAT_TOKEN`: NapCat WebSocket token
- `NAPCAT_START_SCRIPT`: 本机 NapCat 启动脚本路径
- `BOT_NAME`: 通用机器人显示名，未单独配置平台名称时作为回退
- `QQ_USER_ID`: 唯一允许执行远程命令、同时接收通知的 QQ 账号

### Telegram

- `TELEGRAM_BOT_NAME`: Telegram 机器人显示名，未配置时回退到 `BOT_NAME`
- `TELEGRAM_BOT_TOKEN`: Telegram Bot Token
- `TELEGRAM_CHAT_ID`: 唯一允许执行远程命令、同时接收通知的私聊 Chat ID
- `TELEGRAM_API_BASE_URL`: Telegram Bot API 地址，默认 `https://api.telegram.org`
- `TELEGRAM_POLL_TIMEOUT_SECONDS`: 长轮询超时时间，默认 `20`

### 飞书

- `FEISHU_BOT_NAME`: 飞书机器人显示名，未配置时回退到 `BOT_NAME`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_OPEN_ID`: 唯一允许执行远程命令、同时接收通知的目标用户
- `FEISHU_RECEIVE_ID_TYPE`: 默认 `open_id`
- `FEISHU_VERIFICATION_TOKEN`: 事件订阅 token
- `FEISHU_WEBHOOK_HOST`: 本地事件监听地址，默认 `127.0.0.1`
- `FEISHU_WEBHOOK_PORT`: 本地事件监听端口，默认 `3211`
- `FEISHU_WEBHOOK_PATH`: 默认 `/feishu/events`
- `FEISHU_API_BASE_URL`: 默认 `https://open.feishu.cn`

### 企业微信

- `WECOM_BOT_NAME`: 企业微信机器人显示名，未配置时回退到 `BOT_NAME`
- `WECOM_CORP_ID`
- `WECOM_CORP_SECRET`
- `WECOM_AGENT_ID`
- `WECOM_USER_ID`: 唯一允许执行远程命令、同时接收通知的企业微信用户
- `WECOM_TOKEN`: 回调验签 token
- `WECOM_ENCODING_AES_KEY`: 回调消息解密密钥
- `WECOM_WEBHOOK_HOST`: 本地事件监听地址，默认 `127.0.0.1`
- `WECOM_WEBHOOK_PORT`: 本地事件监听端口，默认 `3212`
- `WECOM_WEBHOOK_PATH`: 默认 `/wecom/events`
- `WECOM_API_BASE_URL`: 默认 `https://qyapi.weixin.qq.com`

### 通知过滤

- `NOTIFY_SOURCE_ALLOWLIST`: 允许转发的通知来源，默认包含 `Code, Cursor, Windsurf, Trae, Kiro, CodeBuddy, Antigravity, JetBrains, Zed, Codex, PowerShell`
- `NOTIFY_FILTER_MODE`
- `NOTIFY_KEYWORDS`

### 远程启动命令

- `CODEX_LAUNCH_COMMAND`
- `CURSOR_LAUNCH_COMMAND`
- `TRAE_LAUNCH_COMMAND`
- `TRAE_CN_LAUNCH_COMMAND`
- `CODEBUDDY_LAUNCH_COMMAND`
- `CODEBUDDY_CN_LAUNCH_COMMAND`
- `ANTIGRAVITY_LAUNCH_COMMAND`

如果某个 IDE 的 `open` 拉不起来，优先把本机可执行路径或启动命令写到对应变量里。

### 自动化与截图

- `AUTOMATION_TIMEOUT_MS`: 单次自动化超时，默认 `30000`
- `SCREENSHOT_DIR`: 截图输出目录
- `SCREENSHOT_RETENTION`: 截图保留数量
- `SCREENSHOT_AFTER_ACTION_DELAY_MS`: 粘贴/发送后到截图前的等待时间

### 校准页

- `CALIBRATION_WEB_ENABLED`: 是否启用本地校准页，默认启用
- `CALIBRATION_WEB_HOST`: 校准页监听地址，默认 `127.0.0.1`
- `CALIBRATION_WEB_PORT`: 校准页端口，默认 `3210`

## 远程命令

只有当前平台授权用户发来的私聊文本命令会被执行：

- `napcat`: `QQ_USER_ID`
- `telegram`: `TELEGRAM_CHAT_ID`
- `feishu`: `FEISHU_OPEN_ID`
- `wecom`: `WECOM_USER_ID`

### 通用命令

- `ping`
- `/status`
- `/help`
- `/shot`

也支持中文入口：

- `菜单`
- `状态`

### IDE 远程操作模式

可远程操作的目标为：

- `codex`
- `cursor`
- `trae`
- `traecn`
- `codebuddy`
- `codebuddycn`
- `antigravity`

命令模式统一为：

```text
/<target> <prompt>
/<target> send <prompt>
/<target> paste <prompt>
/<target> open
/<target> focus
/<target> screenshot
```

规则说明：

- `/<target> <prompt>` 等同于 `/<target> send <prompt>`
- `send` 会粘贴并发送
- `paste` 只粘贴，不自动回车
- `open` 用于拉起目标 IDE
- `focus` 会切到目标窗口，并尝试命中聊天输入区
- `screenshot` 会回传当前桌面截图

常用示例：

```text
/codex 帮我检查最近一次改动的风险
/cursor open
/trae paste 先别发送，我要手动确认
/antigravity screenshot
```

## 校准与兼容性

桌面自动化依赖窗口布局和输入框定位。只要你改了 IDE 面板布局、缩放、侧边栏位置，优先校准，不建议直接改脚本。

### 本地校准网页

项目启动后可访问：

```text
http://127.0.0.1:3210/calibration/
```

校准页支持：

- Analyze 当前目标窗口
- 预览候选输入区
- 试跑 `focus` / `paste`
- 保存草稿配置回正式配置文件

### 配置文件

- 自动化布局阈值文件：[config/desktop-automation.config.json](./config/desktop-automation.config.json)

这个文件适合调整：

- 输入区的大致区域比例
- 输入框尺寸阈值
- 特定 IDE 的 `composerSearch`
- 坐标兜底用的 `clickFallback`

### 批处理入口

```bat
calibrate-desktop-automation.bat
calibrate-desktop-automation.bat antigravity calibrate y
```

### PowerShell 脚本入口

```powershell
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp codex -Mode analyze
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp cursor -Mode calibrate
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp trae -Mode analyze
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp traecn -Mode calibrate
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp codebuddy -Mode analyze
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp codebuddycn -Mode calibrate
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp antigravity -Mode analyze
```

说明：

- `analyze` 只扫描当前窗口，输出候选输入区和推断配置
- `calibrate` 会把推断出的 `composerSearch` 写回配置文件
- `-TargetApp` 可用值：`codex|cursor|trae|traecn|codebuddy|codebuddycn|antigravity`
- 应用尚未打开时，可配合 `-OpenIfMissing -LaunchCommand <命令>` 使用

### 兼容性建议

- `Codex`: 相对稳定，默认优先匹配底部编辑器容器
- `Cursor / Trae / Trae CN / Antigravity`: 可用，但依赖聊天面板仍位于窗口右下区域，建议校准后使用
- `CodeBuddy / CodeBuddy CN`: 适配一般，除了候选匹配还依赖坐标兜底点击，建议保守使用

## 调试笔记

- [消息平台接入说明](./docs/messaging-platforms.md)
- [桌面 IDE 自动化通用经验](./docs/desktop-ide-automation-shared-notes.md)
- [Codex Focus 调试经验](./docs/codex-focus-debugging-notes.md)
- [Cursor Focus 调试经验](./docs/cursor-focus-debugging-notes.md)
- [CodeBuddy Focus 调试经验](./docs/codebuddy-focus-debugging-notes.md)
- [Antigravity Focus 调试经验](./docs/antigravity-focus-debugging-notes.md)

## 安全说明

- 不要提交真实 `.env`
- 不要把各平台 token、app secret、用户 ID 或本机绝对路径写死进代码
- 如果凭据已泄露，先在对应平台侧轮换后再继续使用
