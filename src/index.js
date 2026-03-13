import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SOURCE_ALLOWLIST = [
  "Code",
  "Cursor",
  "Windsurf",
  "Trae",
  "Kiro",
  "CodeBuddy",
  "Antigravity",
  "Zed",
  "Codex",
  "PowerShell"
];
const DEDUPE_WINDOW_MS = Number(process.env.NOTIFY_DEDUPE_WINDOW_MS || 10000);
const LISTENER_RESTART_MS = Number(process.env.LISTENER_RESTART_MS || 3000);
const POWERSHELL_PATH = process.env.POWERSHELL_PATH || "powershell.exe";
const FILTER_MODE = process.env.NOTIFY_FILTER_MODE || "all";
const FILTER_KEYWORDS = parseCsv(process.env.NOTIFY_KEYWORDS);
const SOURCE_ALLOWLIST = parseCsv(
  process.env.NOTIFY_SOURCE_ALLOWLIST,
  DEFAULT_SOURCE_ALLOWLIST
).map(normalizeSourceName);

const qqUserId = process.env.QQ_USER_ID || "";
const wsUrl = process.env.NAPCAT_WS_URL || "ws://127.0.0.1:3001";
const token = process.env.NAPCAT_TOKEN || "";
const botName = process.env.BOT_NAME || "NapCatBot";
const listenerScriptPath = path.resolve(__dirname, "../scripts/windows-toast-listener.ps1");
const napcatUrl = token
  ? `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
  : wsUrl;

let socket;
let echoId = 0;
let listenerProcess;
let listenerRestartTimer;
let qqTargetWarningShown = false;

const recentNotifications = new Map();
const pendingActions = new Map();

function parseCsv(value, fallback = []) {
  if (!value) {
    return [...fallback];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSourceName(value) {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return "";
  }

  if (lower.includes("cursor")) {
    return "Cursor";
  }

  if (lower.includes("windsurf")) {
    return "Windsurf";
  }

  if (lower.includes("trae")) {
    return "Trae";
  }

  if (lower.includes("kiro")) {
    return "Kiro";
  }

  if (lower.includes("codebuddy")) {
    return "CodeBuddy";
  }

  if (lower.includes("antigravity")) {
    return "Antigravity";
  }

  if (lower === "zed" || lower.includes("zed editor")) {
    return "Zed";
  }

  if (lower.includes("codex")) {
    return "Codex";
  }

  if (lower === "powershell" || lower === "pwsh" || lower.includes("windows powershell")) {
    return "PowerShell";
  }

  if (
    lower === "code" ||
    lower === "vscode" ||
    lower === "vs code" ||
    lower.includes("visual studio code")
  ) {
    return "Code";
  }

  return raw;
}

function nextEcho() {
  echoId += 1;
  return `echo-${Date.now()}-${echoId}`;
}

function sendAction(action, params) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  const echo = nextEcho();
  socket.send(
    JSON.stringify({
      action,
      params,
      echo
    })
  );

  pendingActions.set(echo, {
    action,
    params,
    createdAt: Date.now()
  });

  return true;
}

function sendPrivateMessage(userId, message) {
  if (!userId) {
    if (!qqTargetWarningShown) {
      qqTargetWarningShown = true;
      console.warn("[notify] QQ_USER_ID is empty, notifications will not be sent");
    }
    return false;
  }

  return sendAction("send_private_msg", {
    user_id: userId,
    message
  });
}

function replyToMessage(event, message) {
  if (event.message_type === "group") {
    return sendAction("send_group_msg", {
      group_id: event.group_id,
      message
    });
  }

  if (event.message_type === "private") {
    return sendPrivateMessage(event.user_id, message);
  }

  return false;
}

function normalizeText(event) {
  return String(event.raw_message || "").trim().toLowerCase();
}

function handleEvent(event) {
  if (event.post_type !== "message") {
    return;
  }

  const text = normalizeText(event);

  if (text === "ping") {
    replyToMessage(event, "pong");
    return;
  }

  if (text === "\u83dc\u5355" || text === "help") {
    replyToMessage(
      event,
      [
        `${botName} \u5df2\u4e0a\u7ebf`,
        "\u53ef\u7528\u6307\u4ee4:",
        "1. ping",
        "2. \u83dc\u5355",
        "3. \u5f53\u524d\u5b9e\u4f8b\u4f1a\u81ea\u52a8\u8f6c\u53d1 Windows IDE/Codex \u901a\u77e5"
      ].join("\n")
    );
  }
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function buildDedupeKey(notification) {
  return [
    notification.sourceLabel || "unknown",
    notification.title || "",
    notification.body || ""
  ]
    .join("|")
    .toLowerCase();
}

function pruneRecentNotifications(now = Date.now()) {
  for (const [key, expiresAt] of recentNotifications.entries()) {
    if (expiresAt <= now) {
      recentNotifications.delete(key);
    }
  }
}

function isDuplicateNotification(notification) {
  const now = Date.now();
  pruneRecentNotifications(now);

  const dedupeKey = notification.dedupeKey || buildDedupeKey(notification);
  const expiresAt = recentNotifications.get(dedupeKey);

  if (expiresAt && expiresAt > now) {
    return true;
  }

  recentNotifications.set(dedupeKey, now + DEDUPE_WINDOW_MS);
  notification.dedupeKey = dedupeKey;
  return false;
}

function normalizeNotificationPayload(payload) {
  const rawLines = Array.isArray(payload.rawLines)
    ? payload.rawLines
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];

  const sourceLabel = normalizeSourceName(payload.sourceApp);

  if (!sourceLabel || !SOURCE_ALLOWLIST.includes(sourceLabel)) {
    return null;
  }

  let title = String(payload.title || "").trim();
  let body = String(payload.body || "").trim();

  if (!title && rawLines.length > 0) {
    title = rawLines.find((line) => normalizeSourceName(line) !== sourceLabel) || "";
  }

  if (!body && rawLines.length > 1) {
    const bodyLines = rawLines.filter(
      (line) => line !== title && normalizeSourceName(line) !== sourceLabel
    );
    body = bodyLines.join(" / ");
  }

  return {
    sourceApp: sourceLabel,
    sourceLabel,
    title,
    body,
    timestamp: payload.timestamp || new Date().toISOString(),
    rawLines,
    category: payload.category || "general",
    workspaceName: payload.workspaceName || null,
    matchReason: payload.matchReason || "source-allowlist",
    dedupeKey: payload.dedupeKey || buildDedupeKey({ sourceLabel, title, body })
  };
}

function formatNotificationMessage(notification) {
  const lines = [`[${notification.sourceLabel}] \u901a\u77e5`];

  if (notification.title) {
    lines.push(`\u6807\u9898: ${notification.title}`);
  }

  if (notification.body) {
    lines.push(`\u5185\u5bb9: ${notification.body}`);
  }

  if (!notification.title && !notification.body) {
    lines.push("\u5185\u5bb9: <empty>");
  }

  lines.push(`\u65f6\u95f4: ${formatTimestamp(notification.timestamp)}`);
  return lines.join("\n");
}

function logCapturedNotification(notification) {
  const summary = {
    source: notification.sourceLabel,
    title: notification.title || "",
    body: notification.body || "",
    rawLines: notification.rawLines
  };

  console.log(`[notify] captured ${JSON.stringify(summary, null, 2)}`);
}

function handleActionResponse(payload) {
  if (!payload.echo) {
    return;
  }

  const request = pendingActions.get(payload.echo);

  if (!request) {
    return;
  }

  pendingActions.delete(payload.echo);

  const targetId = request.params?.user_id ?? request.params?.group_id ?? "unknown";
  const status = payload.status || "unknown";

  if (status === "ok") {
    console.log(
      `[bot] action ok: ${request.action} target=${targetId} echo=${payload.echo}`
    );
    return;
  }

  console.error(
    `[bot] action failed: ${request.action} target=${targetId} echo=${payload.echo} response=${JSON.stringify(payload)}`
  );
}

function handleNotificationPayload(payload) {
  const notification = normalizeNotificationPayload(payload);

  if (!notification) {
    return;
  }

  logCapturedNotification(notification);

  if (isDuplicateNotification(notification)) {
    console.log("[notify] skipped duplicate notification");
    return;
  }

  if (FILTER_MODE !== "all" && FILTER_KEYWORDS.length > 0) {
    console.log(
      `[notify] filter mode is reserved for future use: ${FILTER_MODE} (${FILTER_KEYWORDS.length} keywords loaded)`
    );
  }

  const message = formatNotificationMessage(notification);

  if (!sendPrivateMessage(qqUserId, message)) {
    console.warn(
      `[notify] failed to send notification from ${notification.sourceLabel}; NapCat may be disconnected`
    );
    return;
  }

  console.log(
    `[notify] forwarded ${notification.sourceLabel} notification: ${
      notification.title || notification.body || "<empty>"
    }`
  );
}

function handleListenerLine(line) {
  const trimmed = String(line || "").trim();

  if (!trimmed) {
    return;
  }

  try {
    const payload = JSON.parse(trimmed);
    handleNotificationPayload(payload);
  } catch (error) {
    console.log(`[listener] ${trimmed}`);
  }
}

function scheduleListenerRestart() {
  clearTimeout(listenerRestartTimer);
  listenerRestartTimer = setTimeout(() => {
    startToastListener();
  }, LISTENER_RESTART_MS);
}

function startToastListener() {
  if (process.platform !== "win32") {
    console.warn("[listener] Windows only; toast listener not started");
    return;
  }

  if (!existsSync(listenerScriptPath)) {
    console.error(`[listener] missing script: ${listenerScriptPath}`);
    return;
  }

  if (listenerProcess && !listenerProcess.killed) {
    return;
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    listenerScriptPath,
    "-SourceAllowList",
    SOURCE_ALLOWLIST.join(",")
  ];

  listenerProcess = spawn(POWERSHELL_PATH, args, {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  console.log(`[listener] started with sources: ${SOURCE_ALLOWLIST.join(", ")}`);

  const stdout = createInterface({ input: listenerProcess.stdout });
  const stderr = createInterface({ input: listenerProcess.stderr });

  stdout.on("line", handleListenerLine);
  stderr.on("line", (line) => {
    const message = String(line || "").trim();

    if (message) {
      console.error(`[listener] ${message}`);
    }
  });

  listenerProcess.on("error", (error) => {
    console.error(`[listener] process error: ${error.message}`);
  });

  listenerProcess.on("exit", (code, signal) => {
    stdout.close();
    stderr.close();
    listenerProcess = undefined;

    console.warn(`[listener] exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    scheduleListenerRestart();
  });
}

function connect() {
  socket = new WebSocket(napcatUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  socket.on("open", () => {
    console.log(`[bot] connected: ${napcatUrl}`);
  });

  socket.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString());

      if (payload.post_type) {
        handleEvent(payload);
        return;
      }

      handleActionResponse(payload);
    } catch (error) {
      console.error("[bot] invalid payload", error);
    }
  });

  socket.on("close", () => {
    console.log("[bot] disconnected, retrying in 3s");
    setTimeout(connect, 3000);
  });

  socket.on("error", (error) => {
    console.error("[bot] websocket error", error.message);
  });
}

function shutdown(signal) {
  console.log(`[app] received ${signal}, shutting down`);
  clearTimeout(listenerRestartTimer);

  if (listenerProcess && !listenerProcess.killed) {
    listenerProcess.kill();
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

connect();
startToastListener();
