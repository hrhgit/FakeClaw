import { EventEmitter } from "node:events";
import { FeishuClient } from "./feishu-client.js";
import { createImageSegment, createTextSegment, NapCatClient } from "./napcat-client.js";
import { TelegramClient } from "./telegram-client.js";
import { WecomClient } from "./wecom-client.js";

export const BOT_PLATFORMS = Object.freeze({
  NAPCAT: "napcat",
  TELEGRAM: "telegram",
  FEISHU: "feishu",
  WECOM: "wecom"
});

export function resolveBotPlatform(value = process.env.BOT_PLATFORM) {
  const normalized = String(value || BOT_PLATFORMS.NAPCAT)
    .trim()
    .toLowerCase();

  if (Object.values(BOT_PLATFORMS).includes(normalized)) {
    return normalized;
  }

  return BOT_PLATFORMS.NAPCAT;
}

export function getAuthorizedUserId(platform = resolveBotPlatform()) {
  switch (platform) {
    case BOT_PLATFORMS.TELEGRAM:
      return process.env.TELEGRAM_CHAT_ID || "";
    case BOT_PLATFORMS.FEISHU:
      return process.env.FEISHU_OPEN_ID || "";
    case BOT_PLATFORMS.WECOM:
      return process.env.WECOM_USER_ID || "";
    case BOT_PLATFORMS.NAPCAT:
    default:
      return process.env.QQ_USER_ID || "";
  }
}

export function getPlatformBotName(platform = resolveBotPlatform()) {
  switch (platform) {
    case BOT_PLATFORMS.TELEGRAM:
      return process.env.TELEGRAM_BOT_NAME || process.env.BOT_NAME || "TelegramBot";
    case BOT_PLATFORMS.FEISHU:
      return process.env.FEISHU_BOT_NAME || process.env.BOT_NAME || "FeishuBot";
    case BOT_PLATFORMS.WECOM:
      return process.env.WECOM_BOT_NAME || process.env.BOT_NAME || "WeComBot";
    case BOT_PLATFORMS.NAPCAT:
    default:
      return process.env.QQ_BOT_NAME || process.env.BOT_NAME || "NapCatBot";
  }
}

function forwardClientEvents(source, target) {
  const eventNames = [
    "open",
    "close",
    "error",
    "invalid-payload",
    "event",
    "action-response",
    "action-ok",
    "action-failed"
  ];

  for (const eventName of eventNames) {
    source.on(eventName, (...args) => {
      target.emit(eventName, ...args);
    });
  }
}

function createUnderlyingClient(platform) {
  switch (platform) {
    case BOT_PLATFORMS.TELEGRAM:
      return new TelegramClient({
        botToken: process.env.TELEGRAM_BOT_TOKEN || "",
        apiBaseUrl: process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org",
        pollTimeoutSeconds: process.env.TELEGRAM_POLL_TIMEOUT_SECONDS || 20,
        reconnectDelayMs: process.env.TELEGRAM_RECONNECT_DELAY_MS || 3000
      });
    case BOT_PLATFORMS.FEISHU:
      return new FeishuClient({
        appId: process.env.FEISHU_APP_ID || "",
        appSecret: process.env.FEISHU_APP_SECRET || "",
        openId: process.env.FEISHU_OPEN_ID || "",
        verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || "",
        webhookHost: process.env.FEISHU_WEBHOOK_HOST || "127.0.0.1",
        webhookPort: process.env.FEISHU_WEBHOOK_PORT || 3211,
        webhookPath: process.env.FEISHU_WEBHOOK_PATH || "/feishu/events",
        apiBaseUrl: process.env.FEISHU_API_BASE_URL || "https://open.feishu.cn",
        receiveIdType: process.env.FEISHU_RECEIVE_ID_TYPE || "open_id"
      });
    case BOT_PLATFORMS.WECOM:
      return new WecomClient({
        corpId: process.env.WECOM_CORP_ID || "",
        corpSecret: process.env.WECOM_CORP_SECRET || "",
        agentId: process.env.WECOM_AGENT_ID || "",
        userId: process.env.WECOM_USER_ID || "",
        token: process.env.WECOM_TOKEN || "",
        encodingAesKey: process.env.WECOM_ENCODING_AES_KEY || "",
        webhookHost: process.env.WECOM_WEBHOOK_HOST || "127.0.0.1",
        webhookPort: process.env.WECOM_WEBHOOK_PORT || 3212,
        webhookPath: process.env.WECOM_WEBHOOK_PATH || "/wecom/events",
        apiBaseUrl: process.env.WECOM_API_BASE_URL || "https://qyapi.weixin.qq.com"
      });
    case BOT_PLATFORMS.NAPCAT:
    default:
      return new NapCatClient({
        wsUrl: process.env.NAPCAT_WS_URL || "ws://127.0.0.1:3001",
        token: process.env.NAPCAT_TOKEN || ""
      });
  }
}

export class PlatformClient extends EventEmitter {
  constructor({ platform = resolveBotPlatform() } = {}) {
    super();
    this.platform = resolveBotPlatform(platform);
    this.inner = createUnderlyingClient(this.platform);
    forwardClientEvents(this.inner, this);
  }

  connect() {
    return this.inner.connect();
  }

  close() {
    return this.inner.close();
  }

  isConnected() {
    if (typeof this.inner.isConnected === "function") {
      return this.inner.isConnected();
    }

    return false;
  }

  sendPrivateText(targetId, message) {
    return this.inner.sendPrivateText(targetId, message);
  }

  sendPrivateSegments(targetId, segments) {
    if (typeof this.inner.sendPrivateSegments === "function") {
      return this.inner.sendPrivateSegments(targetId, segments);
    }

    const text = (segments || [])
      .filter((segment) => segment?.type === "text")
      .map((segment) => String(segment?.data?.text || ""))
      .join("\n")
      .trim();

    return this.inner.sendPrivateText(targetId, text);
  }

  uploadPrivateFile(targetId, filePath, name) {
    if (typeof this.inner.uploadPrivateFile === "function") {
      return this.inner.uploadPrivateFile(targetId, filePath, name);
    }

    return Promise.reject(new Error(`upload_private_file_not_supported: ${this.platform}`));
  }
}

export { createTextSegment, createImageSegment };
