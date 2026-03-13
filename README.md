# FakeClaw

一个运行在 Windows 上的 NapCat QQ 通知转发器，同时也是本机 Codex 桌面应用的远程指令桥。

它做两件事：

1. 监听本机 Windows Toast 通知，并转发到指定 QQ。
2. 接收指定 QQ 私聊命令，远程控制这台电脑上的 Codex。

## 功能

- 转发 VS Code、Cursor、Windsurf、Trae、Kiro、CodeBuddy、Antigravity、JetBrains IDEs（含 AI Assistant / Junie）、Zed、Codex、PowerShell 的 Windows 通知到 QQ
- 只允许白名单 QQ 私聊发送控制命令
- 可远程让这台电脑上的 Codex 打开、聚焦、粘贴并发送提示词
- 每次 Codex 任务结束后回传执行结果，并附带桌面截图
- QQ 触发 Codex 自动化后，会在截图流程结束后自动最小化 Codex 窗口
- Codex 任务严格串行执行，忙碌时直接拒绝，不排队

## 依赖

- Windows
- Node.js 22+
- 本机已安装并登录 NapCat
- 已授予 Windows 通知读取权限

NapCat 项目：

- [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [Windows Releases](https://github.com/NapNeko/NapCatQQ/releases)

## 配置

安装依赖并创建配置文件：

```powershell
npm install
Copy-Item .env.example .env
```

至少需要配置这些环境变量：

- `NAPCAT_TOKEN`: NapCat WebSocket token
- `NAPCAT_START_SCRIPT`: 本机 `napcat.bat` 的完整路径
- `QQ_USER_ID`: 接收通知、也允许发送远程命令的 QQ 号
- `CODEX_LAUNCH_COMMAND`: Codex 桌面应用启动命令，通常保持默认即可

常用可选项：

- `NAPCAT_WS_URL`: 默认 `ws://127.0.0.1:3001`
- `NOTIFY_SOURCE_ALLOWLIST`: 允许转发的通知来源
- `AUTOMATION_TIMEOUT_MS`: 单次 Codex 自动化超时，默认 `30000`
- `SCREENSHOT_DIR`: 截图输出目录

示例：

```env
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_TOKEN=your_napcat_token
NAPCAT_START_SCRIPT=E:\path\to\napcat.bat
QQ_USER_ID=your_qq_user_id
CODEX_LAUNCH_COMMAND=shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App
```

## 启动

只启动转发服务：

```powershell
start-app.bat
```

先启动 NapCat，再启动本项目：

```powershell
start-bot.bat
```

开发模式：

```powershell
npm run dev
```

## 远程指令

只有 `QQ_USER_ID` 对应的 QQ 私聊消息会被执行。

- `ping`
- `/status`
- `/codex <prompt>`
- `/codex send <prompt>`
- `/codex paste <prompt>`
- `/codex open`
- `/codex focus`
- `/codex screenshot`
- `/shot`

其中：

- `/codex <prompt>` 等同于 `/codex send <prompt>`
- `/codex send <prompt>` 表示远程向这台电脑上的 Codex 发送一条指令
- `/codex paste <prompt>` 只粘贴到输入框，不自动回车发送
- `/codex open` 用于拉起 Codex
- `/codex focus` 用于切到 Codex 窗口
- `/codex screenshot` 或 `/shot` 用于回传当前桌面截图
- 所有 `/codex` 自动化命令都会在截图完成后自动把 Codex 最小化，便于继续依赖 Codex 前端隐藏时的通知行为

## 安全说明

- 不要提交真实 `.env`
- 不要把 NapCat token、QQ 号、本机绝对路径写死进代码
- 如果 token 已泄露，先在 NapCat 侧轮换后再使用

## 调试笔记

- [Codex Focus 调试经验](./docs/codex-focus-debugging-notes.md)
