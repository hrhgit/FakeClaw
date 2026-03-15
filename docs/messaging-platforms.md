# Messaging Platforms

项目支持按平台切换消息入口，桌面通知转发、`/help`、`/status`、`/shot` 和 IDE 自动化命令共用同一套逻辑。

## 启动脚本

- `startup/start-qq.bat`: QQ / NapCat 模式，会先拉起 NapCat，再启动服务
- `startup/start-telegram.bat`: Telegram 模式，只启动服务
- `startup/start-feishu.bat`: 飞书模式，只启动服务
- `startup/start-wecom.bat`: 企业微信模式，只启动服务

## Telegram

至少配置：

```env
BOT_PLATFORM=telegram
TELEGRAM_BOT_TOKEN=<your bot token>
TELEGRAM_CHAT_ID=<your private chat id>
```

说明：

- 使用 Bot API 长轮询接收私聊文本命令
- 通知和执行结果会回发到 `TELEGRAM_CHAT_ID`
- 截图会作为图片发送

## 飞书

至少配置：

```env
BOT_PLATFORM=feishu
FEISHU_APP_ID=<app id>
FEISHU_APP_SECRET=<app secret>
FEISHU_OPEN_ID=<your open_id>
```

说明：

- 当前实现使用飞书长连接接收私聊文本命令
- 飞书后台需要把订阅方式切换为“使用长连接接收事件”
- 飞书后台仍然需要订阅 `im.message.receive_v1`
- 长连接模式不需要配置请求地址，也不需要内网穿透
- 只需要保证本机运行环境可以访问飞书公网
- 通知和执行结果会回发到 `FEISHU_OPEN_ID`
- 项目侧只需要 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_OPEN_ID`、`FEISHU_RECEIVE_ID_TYPE`、`FEISHU_API_BASE_URL`
- 不再需要配置飞书 webhook host / port / path / verification token

## 企业微信

至少配置：

```env
BOT_PLATFORM=wecom
WECOM_CORP_ID=<corp id>
WECOM_CORP_SECRET=<corp secret>
WECOM_AGENT_ID=<agent id>
WECOM_USER_ID=<your userid>
WECOM_TOKEN=<callback token>
WECOM_ENCODING_AES_KEY=<callback aes key>
WECOM_WEBHOOK_HOST=127.0.0.1
WECOM_WEBHOOK_PORT=3212
WECOM_WEBHOOK_PATH=/wecom/events
```

说明：

- 当前实现按企业微信自建应用处理
- 接收命令依赖回调 URL，服务会验签并解密企业微信回调消息
- 通知和执行结果会作为应用消息回发到 `WECOM_USER_ID`
- 截图优先走图片消息，失败时降级成文件消息
- 如果企业微信后台要求公网 HTTPS 地址，需要你自己提供反向代理或内网穿透

## QQ / NapCat

至少配置：

```env
BOT_PLATFORM=napcat
QQ_BOT_NAME=NapCatBot
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_TOKEN=<token>
NAPCAT_START_SCRIPT=<local napcat bat path>
QQ_USER_ID=<your qq user id>
```

说明：

- 逻辑与原方案保持一致
- `startup/start-qq.bat` 会自动先拉起 NapCat
