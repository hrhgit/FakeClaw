import { EventEmitter } from "node:events";
import "./app-runtime.js";
import { FeishuClient } from "./feishu-client.js";
import { createImageSegment, createTextSegment, NapCatClient } from "./napcat-client.js";
import { TelegramClient } from "./telegram-client.js";
import { WecomClient } from "./wecom-client.js";

export const BOT_PLATFORMS = Object.freeze({
  NONE: "none",
  NAPCAT: "napcat",
  TELEGRAM: "telegram",
  FEISHU: "feishu",
  WECOM: "wecom"
});

const PLATFORM_REQUIRED_ENV_KEYS = Object.freeze({
  [BOT_PLATFORMS.NAPCAT]: ["NAPCAT_TOKEN", "NAPCAT_START_SCRIPT", "QQ_USER_ID"],
  [BOT_PLATFORMS.TELEGRAM]: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  [BOT_PLATFORMS.FEISHU]: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_OPEN_ID"],
  [BOT_PLATFORMS.WECOM]: [
    "WECOM_CORP_ID",
    "WECOM_CORP_SECRET",
    "WECOM_AGENT_ID",
    "WECOM_USER_ID",
    "WECOM_TOKEN",
    "WECOM_ENCODING_AES_KEY"
  ]
});

function hasRequiredEnvValues(keys = []) {
  return keys.every((key) => String(process.env[key] || "").trim());
}

export function hasPlatformConfiguration(platform) {
  const normalized = String(platform || "")
    .trim()
    .toLowerCase();

  const requiredKeys = PLATFORM_REQUIRED_ENV_KEYS[normalized];
  return Boolean(requiredKeys && hasRequiredEnvValues(requiredKeys));
}

export function resolveBotPlatform(value = process.env.BOT_PLATFORM) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized && hasPlatformConfiguration(normalized)) {
    return normalized;
  }

  return BOT_PLATFORMS.NONE;
}

export function getAuthorizedUserId(platform = resolveBotPlatform()) {
  switch (platform) {
    case BOT_PLATFORMS.NONE:
      return "";
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
    case BOT_PLATFORMS.NONE:
      return process.env.BOT_NAME || "FakeClaw";
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

class UnconfiguredPlatformClient extends EventEmitter {
  constructor() {
    super();
    this.platform = BOT_PLATFORMS.NONE;
  }

  connect() {
    return false;
  }

  close() {
    return undefined;
  }

  isConnected() {
    return false;
  }

  sendPrivateText() {
    return Promise.reject(new Error("bot_platform_not_configured"));
  }

  sendPrivateSegments() {
    return Promise.reject(new Error("bot_platform_not_configured"));
  }

  uploadPrivateFile() {
    return Promise.reject(new Error("bot_platform_not_configured"));
  }
}

function createUnderlyingClient(platform) {
  switch (platform) {
    case BOT_PLATFORMS.NONE:
      return new UnconfiguredPlatformClient();
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
