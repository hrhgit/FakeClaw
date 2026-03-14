import { basename } from "node:path";
import { EventEmitter } from "node:events";
import { openAsBlob } from "node:fs";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildTelegramError(method, payload) {
  const description =
    payload?.description || payload?.error_code || payload?.message || `Telegram API failed: ${method}`;
  const error = new Error(String(description));
  error.payload = payload;
  return error;
}

export class TelegramClient extends EventEmitter {
  constructor({
    botToken,
    apiBaseUrl = "https://api.telegram.org",
    pollTimeoutSeconds = 20,
    reconnectDelayMs = 3000
  }) {
    super();
    this.botToken = botToken || "";
    this.apiBaseUrl = String(apiBaseUrl || "https://api.telegram.org").replace(/\/+$/, "");
    this.pollTimeoutSeconds = Number(pollTimeoutSeconds) || 20;
    this.reconnectDelayMs = Number(reconnectDelayMs) || 3000;
    this.closedByApp = false;
    this.offset = 0;
    this.pollPromise = undefined;
  }

  get endpointBase() {
    return `${this.apiBaseUrl}/bot${this.botToken}`;
  }

  isConfigured() {
    return Boolean(this.botToken);
  }

  isConnected() {
    return Boolean(this.pollPromise) && !this.closedByApp;
  }

  connect() {
    this.closedByApp = false;

    if (!this.isConfigured()) {
      const error = new Error("Missing TELEGRAM_BOT_TOKEN");
      this.emit("error", error);
      throw error;
    }

    if (this.pollPromise) {
      return;
    }

    this.emit("open", this.endpointBase);
    this.pollPromise = this.pollLoop().finally(() => {
      this.pollPromise = undefined;
    });
  }

  close() {
    this.closedByApp = true;
  }

  async pollLoop() {
    while (!this.closedByApp) {
      try {
        const updates = await this.api("getUpdates", {
          offset: this.offset,
          timeout: this.pollTimeoutSeconds,
          allowed_updates: ["message"]
        });

        for (const update of updates) {
          this.offset = Math.max(this.offset, Number(update.update_id || 0) + 1);
          this.handleUpdate(update);
        }
      } catch (error) {
        this.emit("error", error);

        if (this.closedByApp) {
          break;
        }

        await delay(this.reconnectDelayMs);
      }
    }

    this.emit("close");
  }

  async api(method, params = {}) {
    const response = await fetch(`${this.endpointBase}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(params)
    });
    const payload = await response.json();

    if (!response.ok || !payload?.ok) {
      throw buildTelegramError(method, payload);
    }

    return payload.result;
  }

  async apiWithFormData(method, formData) {
    const response = await fetch(`${this.endpointBase}/${method}`, {
      method: "POST",
      body: formData
    });
    const payload = await response.json();

    if (!response.ok || !payload?.ok) {
      throw buildTelegramError(method, payload);
    }

    return payload.result;
  }

  handleUpdate(update) {
    const message = update?.message;
    const chat = message?.chat;
    const text = String(message?.text || "").trim();

    if (!message || !chat || chat.type !== "private" || !text) {
      return;
    }

    this.emit("event", {
      post_type: "message",
      message_type: "private",
      user_id: String(chat.id),
      raw_message: text,
      platform: "telegram",
      telegram_update: update
    });
  }

  sendPrivateText(chatId, message) {
    return this.api("sendMessage", {
      chat_id: String(chatId),
      text: String(message ?? "")
    });
  }

  async sendPrivateSegments(chatId, segments) {
    for (const segment of segments || []) {
      if (!segment) {
        continue;
      }

      if (segment.type === "text") {
        const text = String(segment?.data?.text || "").trim();

        if (text) {
          await this.sendPrivateText(chatId, text);
        }

        continue;
      }

      if (segment.type === "image") {
        const filePath = String(segment?.data?.file || "").trim();

        if (!filePath) {
          continue;
        }

        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("photo", await openAsBlob(filePath), basename(filePath));
        await this.apiWithFormData("sendPhoto", formData);
      }
    }
  }

  async uploadPrivateFile(chatId, filePath, name = basename(filePath)) {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("document", await openAsBlob(filePath), name);
    return this.apiWithFormData("sendDocument", formData);
  }
}
