# AIassistant

A Windows-based NapCat QQ notification forwarder. It listens to Windows toast notifications from IDEs and tools such as VS Code, Cursor, Windsurf, Trae, Kiro, CodeBuddy, Antigravity, Zed, Codex, and PowerShell, then forwards them to a target QQ account through the NapCat WebSocket API.

## Features

- Listen for Windows toast notifications
- Filter notifications by source allowlist
- Deduplicate repeated notifications in a short time window
- Forward messages through the NapCat WebSocket API
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
- `QQ_USER_ID`: QQ account that should receive forwarded notifications

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

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `NAPCAT_WS_URL` | NapCat WebSocket endpoint | `ws://127.0.0.1:3001` |
| `NAPCAT_TOKEN` | NapCat access token | empty |
| `NAPCAT_START_SCRIPT` | Local path to the NapCat startup script | empty |
| `BOT_NAME` | Bot display name used in responses | `NapCatBot` |
| `QQ_USER_ID` | QQ account that receives notifications | empty |
| `NOTIFY_SOURCE_ALLOWLIST` | Allowed notification sources | `Code,Cursor,Windsurf,Trae,Kiro,CodeBuddy,Antigravity,Zed,Codex,PowerShell` |
| `NOTIFY_FILTER_MODE` | Reserved filter mode | `all` |
| `NOTIFY_KEYWORDS` | Reserved keyword list, comma-separated | empty |

## Privacy and Security

- Do not commit a real `.env` file
- Do not hardcode NapCat tokens, QQ IDs, or local absolute paths
- If a token has already been exposed elsewhere, rotate it before reuse
