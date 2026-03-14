import { createServer } from "node:http";
import { basename } from "node:path";
import { EventEmitter } from "node:events";
import { openAsBlob } from "node:fs";

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
    verificationToken,
    webhookHost = "127.0.0.1",
    webhookPort = 3211,
    webhookPath = "/feishu/events",
    apiBaseUrl = "https://open.feishu.cn",
    receiveIdType = "open_id"
  }) {
    super();
    this.appId = appId || "";
    this.appSecret = appSecret || "";
    this.openId = openId || "";
    this.verificationToken = verificationToken || "";
    this.webhookHost = webhookHost || "127.0.0.1";
    this.webhookPort = Number(webhookPort) || 3211;
    this.webhookPath = webhookPath || "/feishu/events";
    this.apiBaseUrl = String(apiBaseUrl || "https://open.feishu.cn").replace(/\/+$/, "");
    this.receiveIdType = receiveIdType || "open_id";
    this.server = undefined;
    this.tokenCache = {
      value: "",
      expiresAt: 0
    };
  }

  isConfigured() {
    return Boolean(this.appId && this.appSecret);
  }

  isConnected() {
    return Boolean(this.server?.listening);
  }

  connect() {
    if (!this.isConfigured()) {
      const error = new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
      this.emit("error", error);
      throw error;
    }

    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.emit("error", error);

        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        }

        response.end(JSON.stringify({ code: 500, msg: error.message }));
      });
    });

    this.server.listen(this.webhookPort, this.webhookHost, () => {
      this.emit("open", `http://${this.webhookHost}:${this.webhookPort}${this.webhookPath}`);
    });

    this.server.on("close", () => {
      this.emit("close");
    });

    this.server.on("error", (error) => {
      this.emit("error", error);
    });
  }

  close() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

  async handleRequest(request, response) {
    if (request.method !== "POST" || request.url !== this.webhookPath) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: 404, msg: "not_found" }));
      return;
    }

    const body = await this.readJsonBody(request);
    const verificationPayload = this.resolveVerificationPayload(body);

    if (verificationPayload?.challenge) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ challenge: verificationPayload.challenge }));
      return;
    }

    this.validateVerificationToken(body);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: 0 }));

    this.handleEventPayload(body);
  }

  async readJsonBody(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString("utf8").trim();

    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw buildFeishuError(`Invalid Feishu webhook payload: ${error.message}`);
    }
  }

  resolveVerificationPayload(body) {
    if (body?.type === "url_verification" && body?.challenge) {
      return body;
    }

    if (body?.schema === "2.0" && body?.challenge) {
      return body;
    }

    return null;
  }

  validateVerificationToken(body) {
    if (!this.verificationToken) {
      return;
    }

    const receivedToken = body?.token || body?.header?.token || "";

    if (receivedToken && receivedToken === this.verificationToken) {
      return;
    }

    throw buildFeishuError("Invalid FEISHU_VERIFICATION_TOKEN");
  }

  handleEventPayload(body) {
    const eventType = body?.header?.event_type || body?.event?.type || "";

    if (eventType !== "im.message.receive_v1") {
      return;
    }

    const event = body?.event || {};
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
      feishu_event: body
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
