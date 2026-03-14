import { createDecipheriv, createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { basename } from "node:path";

function buildWecomError(message, payload) {
  const error = new Error(message);
  error.payload = payload;
  return error;
}

function extractXmlValue(xml, tagName) {
  const cdataMatch = xml.match(new RegExp(`<${tagName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, "i"));

  if (cdataMatch) {
    return cdataMatch[1];
  }

  const plainMatch = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return plainMatch ? plainMatch[1].trim() : "";
}

function createSignature(token, timestamp, nonce, encrypted) {
  const parts = [token, timestamp, nonce, encrypted].map((item) => String(item ?? "")).sort();
  return createHash("sha1").update(parts.join(""), "utf8").digest("hex");
}

export class WecomClient extends EventEmitter {
  constructor({
    corpId,
    corpSecret,
    agentId,
    userId,
    token,
    encodingAesKey,
    webhookHost = "127.0.0.1",
    webhookPort = 3212,
    webhookPath = "/wecom/events",
    apiBaseUrl = "https://qyapi.weixin.qq.com"
  }) {
    super();
    this.corpId = corpId || "";
    this.corpSecret = corpSecret || "";
    this.agentId = Number(agentId) || 0;
    this.userId = userId || "";
    this.token = token || "";
    this.encodingAesKey = encodingAesKey || "";
    this.webhookHost = webhookHost || "127.0.0.1";
    this.webhookPort = Number(webhookPort) || 3212;
    this.webhookPath = webhookPath || "/wecom/events";
    this.apiBaseUrl = String(apiBaseUrl || "https://qyapi.weixin.qq.com").replace(/\/+$/, "");
    this.server = undefined;
    this.tokenCache = {
      value: "",
      expiresAt: 0
    };
  }

  isConfigured() {
    return Boolean(
      this.corpId &&
        this.corpSecret &&
        this.agentId &&
        this.token &&
        this.encodingAesKey
    );
  }

  isConnected() {
    return Boolean(this.server?.listening);
  }

  connect() {
    if (!this.isConfigured()) {
      const error = new Error(
        "Missing WECOM_CORP_ID, WECOM_CORP_SECRET, WECOM_AGENT_ID, WECOM_TOKEN or WECOM_ENCODING_AES_KEY"
      );
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
          response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        }

        response.end("error");
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

  getAesKeyBuffer() {
    if (!this.encodingAesKey) {
      throw buildWecomError("Missing WECOM_ENCODING_AES_KEY");
    }

    return Buffer.from(`${this.encodingAesKey}=`, "base64");
  }

  decryptMessage(encrypted) {
    const aesKey = this.getAesKeyBuffer();
    const encryptedBuffer = Buffer.from(String(encrypted || ""), "base64");
    const iv = aesKey.subarray(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", aesKey, iv);
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    const pad = decrypted[decrypted.length - 1];
    const unpadded = decrypted.subarray(0, decrypted.length - pad);
    const content = unpadded.subarray(16);
    const xmlLength = content.readUInt32BE(0);
    const xml = content.subarray(4, 4 + xmlLength).toString("utf8");
    const corpId = content.subarray(4 + xmlLength).toString("utf8");

    if (corpId !== this.corpId) {
      throw buildWecomError("WECOM_CORP_ID mismatch while decrypting callback payload");
    }

    return xml;
  }

  validateSignature({ timestamp, nonce, encrypted, signature }) {
    const expected = createSignature(this.token, timestamp, nonce, encrypted);

    if (expected !== signature) {
      throw buildWecomError("Invalid WeCom callback signature");
    }
  }

  async readBody(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf8");
  }

  async handleRequest(request, response) {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname !== this.webhookPath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not_found");
      return;
    }

    if (request.method === "GET") {
      const msgSignature = requestUrl.searchParams.get("msg_signature") || "";
      const timestamp = requestUrl.searchParams.get("timestamp") || "";
      const nonce = requestUrl.searchParams.get("nonce") || "";
      const echostr = requestUrl.searchParams.get("echostr") || "";

      this.validateSignature({
        timestamp,
        nonce,
        encrypted: echostr,
        signature: msgSignature
      });

      const plainText = this.decryptMessage(echostr);
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(plainText);
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("method_not_allowed");
      return;
    }

    const timestamp = requestUrl.searchParams.get("timestamp") || "";
    const nonce = requestUrl.searchParams.get("nonce") || "";
    const msgSignature = requestUrl.searchParams.get("msg_signature") || "";
    const rawXml = await this.readBody(request);
    const encrypted = extractXmlValue(rawXml, "Encrypt");

    if (!encrypted) {
      throw buildWecomError("Missing Encrypt field in WeCom callback");
    }

    this.validateSignature({
      timestamp,
      nonce,
      encrypted,
      signature: msgSignature
    });

    const plainXml = this.decryptMessage(encrypted);
    this.handleEventXml(plainXml);

    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("success");
  }

  handleEventXml(xml) {
    const msgType = extractXmlValue(xml, "MsgType").toLowerCase();
    const fromUserName = extractXmlValue(xml, "FromUserName");
    const content = extractXmlValue(xml, "Content").trim();

    if (msgType !== "text" || !fromUserName || !content) {
      return;
    }

    this.emit("event", {
      post_type: "message",
      message_type: "private",
      user_id: String(fromUserName),
      raw_message: content,
      platform: "wecom",
      wecom_xml: xml
    });
  }

  async getAccessToken() {
    if (this.tokenCache.value && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.value;
    }

    const query = new URLSearchParams({
      corpid: this.corpId,
      corpsecret: this.corpSecret
    });
    const response = await fetch(`${this.apiBaseUrl}/cgi-bin/gettoken?${query.toString()}`);
    const payload = await response.json();

    if (!response.ok || payload?.errcode !== 0 || !payload?.access_token) {
      throw buildWecomError(payload?.errmsg || "Failed to get WeCom access token", payload);
    }

    this.tokenCache = {
      value: payload.access_token,
      expiresAt: Date.now() + Math.max(Number(payload.expires_in || 7200) - 120, 60) * 1000
    };

    return this.tokenCache.value;
  }

  async api(pathname, { method = "GET", body, formData } = {}) {
    const accessToken = await this.getAccessToken();
    const url = `${this.apiBaseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;
    const init = { method, headers: {} };

    if (formData) {
      init.body = formData;
    } else if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const payload = await response.json();

    if (!response.ok || payload?.errcode !== 0) {
      throw buildWecomError(payload?.errmsg || `WeCom API failed: ${pathname}`, payload);
    }

    return payload;
  }

  sendPrivateText(userId, message) {
    return this.api("/cgi-bin/message/send", {
      method: "POST",
      body: {
        touser: String(userId),
        msgtype: "text",
        agentid: this.agentId,
        text: {
          content: String(message ?? "")
        },
        safe: 0
      }
    });
  }

  async uploadMedia(type, filePath, name = basename(filePath)) {
    const formData = new FormData();
    formData.append("media", await openAsBlob(filePath), name);
    const payload = await this.api(`/cgi-bin/media/upload?type=${encodeURIComponent(type)}`, {
      method: "POST",
      formData
    });
    return payload?.media_id || "";
  }

  async sendPrivateSegments(userId, segments) {
    for (const segment of segments || []) {
      if (!segment) {
        continue;
      }

      if (segment.type === "text") {
        const text = String(segment?.data?.text || "").trim();

        if (text) {
          await this.sendPrivateText(userId, text);
        }

        continue;
      }

      if (segment.type === "image") {
        const filePath = String(segment?.data?.file || "").trim();

        if (!filePath) {
          continue;
        }

        const mediaId = await this.uploadMedia("image", filePath);
        await this.api("/cgi-bin/message/send", {
          method: "POST",
          body: {
            touser: String(userId),
            msgtype: "image",
            agentid: this.agentId,
            image: {
              media_id: mediaId
            },
            safe: 0
          }
        });
      }
    }
  }

  async uploadPrivateFile(userId, filePath, name = basename(filePath)) {
    const mediaId = await this.uploadMedia("file", filePath, name);
    return this.api("/cgi-bin/message/send", {
      method: "POST",
      body: {
        touser: String(userId),
        msgtype: "file",
        agentid: this.agentId,
        file: {
          media_id: mediaId
        },
        safe: 0
      }
    });
  }
}
