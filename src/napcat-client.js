import { EventEmitter } from "node:events";
import WebSocket from "ws";

function createEchoFactory() {
  let echoId = 0;

  return function nextEcho() {
    echoId += 1;
    return `echo-${Date.now()}-${echoId}`;
  };
}

export function createTextSegment(text) {
  return {
    type: "text",
    data: {
      text: String(text ?? "")
    }
  };
}

export function createImageSegment(filePath) {
  return {
    type: "image",
    data: {
      file: String(filePath)
    }
  };
}

export class NapCatClient extends EventEmitter {
  constructor({ wsUrl, token, actionTimeoutMs = 15000, reconnectDelayMs = 3000 }) {
    super();
    this.wsUrl = wsUrl || "ws://127.0.0.1:3001";
    this.token = token || "";
    this.actionTimeoutMs = Number(actionTimeoutMs) || 15000;
    this.reconnectDelayMs = Number(reconnectDelayMs) || 3000;
    this.nextEcho = createEchoFactory();
    this.pendingActions = new Map();
    this.socket = undefined;
    this.reconnectTimer = undefined;
    this.closedByApp = false;
  }

  get napcatUrl() {
    if (!this.token) {
      return this.wsUrl;
    }

    return `${this.wsUrl}${this.wsUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(
      this.token
    )}`;
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    this.closedByApp = false;

    this.socket = new WebSocket(this.napcatUrl, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined
    });

    this.socket.on("open", () => {
      this.emit("open", this.napcatUrl);
    });

    this.socket.on("message", (data) => {
      this.handleMessage(data);
    });

    this.socket.on("close", () => {
      this.rejectPendingActions(new Error("NapCat websocket closed"));
      this.emit("close");

      if (!this.closedByApp) {
        this.reconnectTimer = setTimeout(() => {
          this.connect();
        }, this.reconnectDelayMs);
      }
    });

    this.socket.on("error", (error) => {
      this.emit("error", error);
    });
  }

  close() {
    this.closedByApp = true;
    clearTimeout(this.reconnectTimer);
    this.rejectPendingActions(new Error("NapCat client closed"));

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  handleMessage(data) {
    let payload;

    try {
      payload = JSON.parse(data.toString());
    } catch (error) {
      this.emit("invalid-payload", error, data.toString());
      return;
    }

    if (payload.post_type) {
      this.emit("event", payload);
      return;
    }

    this.handleActionResponse(payload);
  }

  handleActionResponse(payload) {
    if (!payload.echo) {
      this.emit("action-response", payload);
      return;
    }

    const request = this.pendingActions.get(payload.echo);

    if (!request) {
      this.emit("action-response", payload);
      return;
    }

    clearTimeout(request.timer);
    this.pendingActions.delete(payload.echo);

    if (payload.status === "ok") {
      request.resolve(payload);
      this.emit("action-ok", payload, request.meta);
      return;
    }

    const error = new Error(
      payload?.message || payload?.wording || `NapCat action failed: ${request.meta.action}`
    );
    error.payload = payload;
    error.meta = request.meta;
    request.reject(error);
    this.emit("action-failed", error, request.meta);
  }

  rejectPendingActions(error) {
    for (const { reject, timer } of this.pendingActions.values()) {
      clearTimeout(timer);
      reject(error);
    }

    this.pendingActions.clear();
  }

  sendAction(action, params) {
    if (!this.isConnected()) {
      return Promise.reject(new Error("NapCat websocket is not connected"));
    }

    const echo = this.nextEcho();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(echo);
        reject(new Error(`NapCat action timeout: ${action}`));
      }, this.actionTimeoutMs);

      this.pendingActions.set(echo, {
        resolve,
        reject,
        timer,
        meta: {
          action,
          params,
          echo,
          createdAt: Date.now()
        }
      });

      this.socket.send(
        JSON.stringify({
          action,
          params,
          echo
        })
      );
    });
  }

  sendPrivateText(userId, message) {
    return this.sendPrivateSegments(userId, [createTextSegment(message)]);
  }

  sendPrivateSegments(userId, segments) {
    return this.sendAction("send_private_msg", {
      user_id: Number(userId),
      message: segments
    });
  }

  sendGroupText(groupId, message) {
    return this.sendAction("send_group_msg", {
      group_id: Number(groupId),
      message: [createTextSegment(message)]
    });
  }

  uploadPrivateFile(userId, filePath, name) {
    return this.sendAction("upload_private_file", {
      user_id: Number(userId),
      file: filePath,
      name
    });
  }
}
