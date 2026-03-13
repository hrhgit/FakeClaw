# AIassistant

A Windows-based NapCat QQ notification forwarder and Codex command bridge. It listens to Windows toast notifications from IDEs and tools such as VS Code, Cursor, Windsurf, Trae, Kiro, CodeBuddy, Antigravity, Zed, Codex, and PowerShell, forwards them to a target QQ account through the NapCat WebSocket API, and can accept QQ private commands to drive the local Codex desktop app.

## Features

- Listen for Windows toast notifications
- Filter notifications by source allowlist
- Deduplicate repeated notifications in a short time window
- Forward messages through the NapCat WebSocket API
- Accept `/codex <prompt>` from a single QQ allowlist user
- Enforce strict single-task execution for Codex automation
- Capture and return a desktop screenshot after each Codex task
- Provide batch scripts to start NapCat and the forwarder service

## Requirements

- Windows
- Node.js 22 or later
- NapCat installed locally
- Windows notification access enabled for the listener

## NapCat

- Official repo: [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- Windows download: [NapCatQQ Releases](https://github.com/NapNeko/NapCatQQ/releases)

Simple setup:

1. Download the Windows one-click package from the Releases page and extract it locally.
2. Start NapCat once and log in to the QQ account used by the bot.
3. Confirm the local WebSocket service is enabled, then copy the access token shown by NapCat.
4. Set `NAPCAT_START_SCRIPT` to your local `napcat.bat` path.
5. Set `NAPCAT_TOKEN` and `QQ_USER_ID` in `.env`.
6. Keep `NAPCAT_WS_URL` as `ws://127.0.0.1:3001` unless your local NapCat uses a different port.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and set at least these values:

- `NAPCAT_TOKEN`: NapCat access token
- `NAPCAT_START_SCRIPT`: Local path to `napcat.bat`
- `QQ_USER_ID`: QQ account that should receive forwarded notifications and send commands
- `CODEX_LAUNCH_COMMAND`: Launch command for Codex if it is not already running

## Run

Start only the forwarder service:

```powershell
start-app.bat
```

Start both NapCat and the forwarder:

```powershell
start-bot.bat
```

Development mode:

```powershell
npm run dev
```

## QQ Commands

Only private messages from `QQ_USER_ID` can trigger commands.

- `ping`
- `菜单` / `help`
- `/status` / `状态`
- `/codex <prompt>`
- `/codex open`
- `/codex focus`
- `/codex screenshot`
- `/codex paste <prompt>`
- `/codex send <prompt>`
- `/shot`

`/codex <prompt>` is the same as `/codex send <prompt>`.

Codex tasks are strictly serialized. If one task is still running, the next `/codex` command is rejected immediately and is not queued.

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `NAPCAT_WS_URL` | NapCat WebSocket endpoint | `ws://127.0.0.1:3001` |
| `NAPCAT_TOKEN` | NapCat access token | empty |
| `NAPCAT_START_SCRIPT` | Local path to the NapCat startup script | empty |
| `BOT_NAME` | Bot display name used in responses | `NapCatBot` |
| `QQ_USER_ID` | QQ account that receives notifications and can issue commands | empty |
| `NOTIFY_SOURCE_ALLOWLIST` | Allowed notification sources | `Code,Cursor,Windsurf,Trae,Kiro,CodeBuddy,Antigravity,Zed,Codex,PowerShell` |
| `NOTIFY_FILTER_MODE` | Reserved filter mode | `all` |
| `NOTIFY_KEYWORDS` | Reserved keyword list, comma-separated | empty |
| `CODEX_LAUNCH_COMMAND` | Launch command for Codex desktop | `shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App` |
| `AUTOMATION_TIMEOUT_MS` | Timeout for a single Codex task | `30000` |
| `SCREENSHOT_DIR` | Optional screenshot output directory | system temp dir |
| `SCREENSHOT_RETENTION` | Number of recent screenshots to retain | `20` |
| `SCREENSHOT_AFTER_ACTION_DELAY_MS` | Delay before taking the post-task screenshot for `/codex paste` and `/codex send` | `1200` |

## Privacy and Security

- Do not commit a real `.env` file
- Do not hardcode NapCat tokens, QQ IDs, or local absolute paths
- If a token has already been exposed elsewhere, rotate it before reuse
