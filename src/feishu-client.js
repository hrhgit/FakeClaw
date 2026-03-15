import { basename } from "node:path";
import { EventEmitter } from "node:events";
import { openAsBlob } from "node:fs";
import { WebSocket } from "ws";
import * as lark from "@larksuiteoapi/node-sdk";

function buildFeishuError(message, payload) {
  const error = new Error(message);
  error.payload = payload;
  return error;
}

export class FeishuClient extends EventEmitter {
  constructor({
    appId,
    appSecret,
    openId,
    apiBaseUrl = "https://open.feishu.cn",
    receiveIdType = "open_id"
  }) {
    super();
    this.appId = appId || "";
    this.appSecret = appSecret || "";
    this.openId = openId || "";
    this.apiBaseUrl = String(apiBaseUrl || "https://open.feishu.cn").replace(/\/+$/, "");
    this.receiveIdType = receiveIdType || "open_id";
    this.wsClient = undefined;
    this.connectPromise = undefined;
    this.tokenCache = {
      value: "",
      expiresAt: 0
    };
  }

  isConfigured() {
    return Boolean(this.appId && this.appSecret);
  }

  isConnected() {
    const wsInstance = this.wsClient?.wsConfig?.getWSInstance?.();
    return wsInstance?.readyState === WebSocket.OPEN;
  }

  connect() {
    if (!this.isConfigured()) {
      const error = new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
      this.emit("error", error);
      throw error;
    }

    if (this.wsClient || this.connectPromise) {
      return;
    }

    const eventDispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (event) => {
        this.handleMessageEvent(event);
      }
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.warn
    });

    this.connectPromise = this.wsClient
      .start({ eventDispatcher })
      .then(() => {
        this.emit("open", "feishu://long-connection");
      })
      .catch((error) => {
        this.wsClient = undefined;
        this.emit("error", error);
      })
      .finally(() => {
        this.connectPromise = undefined;
      });
  }

  close() {
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = undefined;
    }

    this.connectPromise = undefined;
    this.emit("close");
  }

  handleMessageEvent(event) {
    const message = event?.message || {};
    const sender = event?.sender || {};
    const senderId = sender?.sender_id || {};
    const openId = senderId?.open_id || senderId?.user_id || "";
    const chatType = String(message?.chat_type || "").toLowerCase();
    const messageType = String(message?.message_type || "").toLowerCase();

    if (!openId || chatType !== "p2p" || messageType !== "text") {
      return;
    }

    let text = "";

    try {
      const content = JSON.parse(message?.content || "{}");
      text = String(content?.text || "").trim();
    } catch (error) {
      this.emit("invalid-payload", error, message?.content || "");
      return;
    }

    if (!text) {
      return;
    }

    this.emit("event", {
      post_type: "message",
      message_type: "private",
      user_id: String(openId),
      raw_message: text,
      platform: "feishu",
      feishu_event: event
    });
  }

  async getTenantAccessToken() {
    if (this.tokenCache.value && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.value;
    }

    const response = await fetch(`${this.apiBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret
      })
    });
    const payload = await response.json();

    if (!response.ok || payload?.code !== 0 || !payload?.tenant_access_token) {
      throw buildFeishuError(payload?.msg || "Failed to get tenant access token", payload);
    }

    this.tokenCache = {
      value: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max(Number(payload.expire || 0) - 120, 60) * 1000
    };

    return this.tokenCache.value;
  }

  async api(pathname, { method = "GET", body, formData, headers = {} } = {}) {
    const token = await this.getTenantAccessToken();
    const requestHeaders = {
      Authorization: `Bearer ${token}`,
      ...headers
    };
    const init = {
      method,
      headers: requestHeaders
    };

    if (formData) {
      init.body = formData;
    } else if (body !== undefined) {
      requestHeaders["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.apiBaseUrl}${pathname}`, init);
    const payload = await response.json();

    if (!response.ok || payload?.code !== 0) {
      throw buildFeishuError(payload?.msg || `Feishu API failed: ${pathname}`, payload);
    }

    return payload;
  }

  sendPrivateText(openId, message) {
    return this.api(`/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(this.receiveIdType)}`, {
      method: "POST",
      body: {
        receive_id: String(openId),
        msg_type: "text",
        content: JSON.stringify({
          text: String(message ?? "")
        })
      }
    });
  }

  async uploadImage(filePath) {
    const formData = new FormData();
    formData.append("image_type", "message");
    formData.append("image", await openAsBlob(filePath), basename(filePath));
    const payload = await this.api("/open-apis/im/v1/images", {
      method: "POST",
      formData
    });
    return payload?.data?.image_key || "";
  }

  async sendPrivateSegments(openId, segments) {
    for (const segment of segments || []) {
      if (!segment) {
        continue;
      }

      if (segment.type === "text") {
        const text = String(segment?.data?.text || "").trim();

        if (text) {
          await this.sendPrivateText(openId, text);
        }

        continue;
      }

      if (segment.type === "image") {
        const filePath = String(segment?.data?.file || "").trim();

        if (!filePath) {
          continue;
        }

        const imageKey = await this.uploadImage(filePath);

        await this.api(
          `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(this.receiveIdType)}`,
          {
            method: "POST",
            body: {
              receive_id: String(openId),
              msg_type: "image",
              content: JSON.stringify({
                image_key: imageKey
              })
            }
          }
        );
      }
    }
  }
}
