# FakeClaw

一个运行在 Windows 上的 NapCat QQ 通知转发器，同时也是这台电脑上多种 IDE 的远程操作桥。

## 主要功能

- 把这台 Windows 机器上的 IDE、终端和桌面应用通知转发到指定 QQ，方便在离开电脑时继续看本机动静
- 通过 QQ 私聊远程拉起本机 IDE，切换到目标窗口，并把提示词粘贴到聊天输入区
- 支持按需只粘贴不发送，适合先远程准备提示词、再回到电脑上手动确认
- 每次自动化任务结束后都会回传执行结果，并附带桌面截图，方便确认到底有没有命中正确窗口和输入区
- 支持通过统一配置、校准脚本和本地校准网页修正不同机器、不同分辨率、不同 IDE 布局下的输入框定位问题

## 本次更新

- 远程操作目标从原先的少数桌面应用扩展到 `Codex / Cursor / Trae / Trae CN / CodeBuddy / CodeBuddy CN / Antigravity`
- 统一了桌面自动化配置，布局阈值集中放在 [config/desktop-automation.config.json](./config/desktop-automation.config.json)
- 新增桌面校准脚本和批处理入口，方便在不同机器上重新标定输入框位置
- 新增本地校准网页，可在浏览器里分析候选输入区、试跑草稿配置并保存

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
- 本机已安装并登录 NapCat
- 已授予 Windows 通知读取权限

NapCat 项目：

- [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [Windows Releases](https://github.com/NapNeko/NapCatQQ/releases)

### 安装与初始化

```powershell
npm install
Copy-Item .env.example .env
```

至少需要配置：

- `NAPCAT_TOKEN`
- `NAPCAT_START_SCRIPT`
- `QQ_USER_ID`
- 你准备远程操作的 IDE 对应 `*_LAUNCH_COMMAND`

### 启动方式

只启动转发服务：

```powershell
start-app.bat
```

先拉起 NapCat，再启动本项目：

```powershell
start-bot.bat
```

开发模式：

```powershell
npm run dev
```

## 环境变量

以下变量以 [.env.example](./.env.example) 为准。

### 核心连接

- `NAPCAT_WS_URL`: NapCat WebSocket 地址，默认 `ws://127.0.0.1:3001`
- `NAPCAT_TOKEN`: NapCat WebSocket token
- `NAPCAT_START_SCRIPT`: 本机 NapCat 启动脚本路径
- `BOT_NAME`: 机器人显示名
- `QQ_USER_ID`: 唯一允许执行远程命令、同时接收通知的 QQ 账号

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

示例：

```env
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_TOKEN=your_napcat_token
NAPCAT_START_SCRIPT=E:\path\to\napcat.bat
BOT_NAME=NapCatBot
QQ_USER_ID=your_qq_user_id
NOTIFY_SOURCE_ALLOWLIST=Code,Cursor,Windsurf,Trae,Kiro,CodeBuddy,Antigravity,JetBrains,Zed,Codex,PowerShell
CODEX_LAUNCH_COMMAND=shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App
CURSOR_LAUNCH_COMMAND=C:\Users\<you>\AppData\Local\Programs\Cursor\Cursor.exe
TRAE_LAUNCH_COMMAND=C:\Users\<you>\AppData\Local\Programs\Trae\Trae.exe
TRAE_CN_LAUNCH_COMMAND=C:\Users\<you>\AppData\Local\Programs\Trae CN\Trae CN.exe
CODEBUDDY_LAUNCH_COMMAND=C:\Users\<you>\AppData\Local\Programs\CodeBuddy\CodeBuddy.exe
CODEBUDDY_CN_LAUNCH_COMMAND=C:\Users\<you>\AppData\Local\Programs\CodeBuddy\CodeBuddy CN.exe
ANTIGRAVITY_LAUNCH_COMMAND=C:\Users\<you>\AppData\Local\Programs\Antigravity\Antigravity.exe
AUTOMATION_TIMEOUT_MS=30000
SCREENSHOT_RETENTION=20
CALIBRATION_WEB_ENABLED=true
CALIBRATION_WEB_HOST=127.0.0.1
CALIBRATION_WEB_PORT=3210
```

## 远程命令

只有 `QQ_USER_ID` 对应的 QQ 私聊消息会被执行。

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

### 兼容性建议

- `Codex`: 相对稳定，默认优先匹配底部编辑器容器
- `Cursor / Trae / Trae CN / Antigravity`: 可用，但依赖聊天面板仍位于窗口右下区域，建议校准后使用
- `CodeBuddy / CodeBuddy CN`: 适配一般，除了候选匹配还依赖坐标兜底点击，建议保守使用

## 调试笔记

- [桌面 IDE 自动化通用经验](./docs/desktop-ide-automation-shared-notes.md)
- [Codex Focus 调试经验](./docs/codex-focus-debugging-notes.md)
- [Cursor Focus 调试经验](./docs/cursor-focus-debugging-notes.md)
- [CodeBuddy Focus 调试经验](./docs/codebuddy-focus-debugging-notes.md)
- [Antigravity Focus 调试经验](./docs/antigravity-focus-debugging-notes.md)

## 安全说明

- 不要提交真实 `.env`
- 不要把 NapCat token、QQ 号或本机绝对路径写死进代码
- 如果 token 已泄露，先在 NapCat 侧轮换后再继续使用
