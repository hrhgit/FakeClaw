import "dotenv/config";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path, { basename } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  CODEX_AUTOMATION_MODES,
  captureDesktopEvidence,
  formatTimestamp,
  runCodexAutomation
} from "./automation.js";
import { createImageSegment, createTextSegment, NapCatClient } from "./napcat-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MENU_COMMAND_ZH = "\u83dc\u5355";
const STATUS_COMMAND_ZH = "\u72b6\u6001";

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

const IDE_HELP_SECTIONS = [
  {
    label: "VS Code 系",
    sources: ["Code", "Cursor", "Windsurf", "Trae", "Kiro", "CodeBuddy", "Antigravity"]
  },
  {
    label: "独立编辑器",
    sources: ["Zed"]
  },
  {
    label: "自动化目标",
    sources: ["Codex"]
  },
  {
    label: "终端工具",
    sources: ["PowerShell"]
  }
];

const IDE_HELP_DETAILS = {
  Code: {
    topic: "code",
    displayName: "VS Code",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Cursor: {
    topic: "cursor",
    displayName: "Cursor",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Windsurf: {
    topic: "windsurf",
    displayName: "Windsurf",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Trae: {
    topic: "trae",
    displayName: "Trae",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Kiro: {
    topic: "kiro",
    displayName: "Kiro",
    section: "VS Code 系",
    capability: "通知转发"
  },
  CodeBuddy: {
    topic: "codebuddy",
    displayName: "CodeBuddy",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Antigravity: {
    topic: "antigravity",
    displayName: "Antigravity",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Zed: {
    topic: "zed",
    displayName: "Zed",
    section: "独立编辑器",
    capability: "通知转发"
  },
  Codex: {
    topic: "codex-app",
    displayName: "Codex",
    section: "自动化目标",
    capability: "通知转发 + 本地自动化目标"
  },
  PowerShell: {
    topic: "powershell",
    displayName: "PowerShell",
    section: "终端工具",
    capability: "通知转发"
  }
};

const DEDUPE_WINDOW_MS = Number(process.env.NOTIFY_DEDUPE_WINDOW_MS || 10000);
const LISTENER_RESTART_MS = Number(process.env.LISTENER_RESTART_MS || 3000);
const POWERSHELL_PATH = process.env.POWERSHELL_PATH || "powershell.exe";
const FILTER_MODE = process.env.NOTIFY_FILTER_MODE || "all";
const FILTER_KEYWORDS = parseCsv(process.env.NOTIFY_KEYWORDS);
const SOURCE_ALLOWLIST = parseCsv(
  process.env.NOTIFY_SOURCE_ALLOWLIST,
  DEFAULT_SOURCE_ALLOWLIST
).map(normalizeSourceName);
const AUTOMATION_TIMEOUT_MS = Number(process.env.AUTOMATION_TIMEOUT_MS || 30000);
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "";
const SCREENSHOT_RETENTION = Number(process.env.SCREENSHOT_RETENTION || 20);

const qqUserId = process.env.QQ_USER_ID || "";
const wsUrl = process.env.NAPCAT_WS_URL || "ws://127.0.0.1:3001";
const token = process.env.NAPCAT_TOKEN || "";
const botName = process.env.BOT_NAME || "NapCatBot";
const listenerScriptPath = path.resolve(__dirname, "../scripts/windows-toast-listener.ps1");
const instanceLockPath = path.resolve(__dirname, "../.fakeclaw.lock");

const client = new NapCatClient({ wsUrl, token });
const recentNotifications = new Map();

let listenerProcess;
let listenerRestartTimer;
let qqTargetWarningShown = false;
let instanceLockFd;
let taskCounter = 0;
let currentTask = null;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function releaseSingleInstanceLock() {
  if (instanceLockFd !== undefined) {
    closeSync(instanceLockFd);
    instanceLockFd = undefined;
  }

  if (existsSync(instanceLockPath)) {
    try {
      unlinkSync(instanceLockPath);
    } catch (error) {
      console.warn(`[app] failed to remove lock file: ${error.message}`);
    }
  }
}

function ensureSingleInstance() {
  try {
    instanceLockFd = openSync(instanceLockPath, "wx");
    writeFileSync(instanceLockFd, String(process.pid), "utf8");
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      console.error(`[app] failed to create lock file: ${error.message}`);
      return false;
    }
  }

  try {
    const existingPid = Number.parseInt(readFileSync(instanceLockPath, "utf8").trim(), 10);

    if (isProcessAlive(existingPid)) {
      console.error(`[app] another instance is already running (pid=${existingPid})`);
      return false;
    }

    unlinkSync(instanceLockPath);
    instanceLockFd = openSync(instanceLockPath, "wx");
    writeFileSync(instanceLockFd, String(process.pid), "utf8");
    console.warn(`[app] replaced stale lock file from pid=${existingPid || "unknown"}`);
    return true;
  } catch (retryError) {
    console.error(`[app] failed to acquire instance lock: ${retryError.message}`);
    return false;
  }
}

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
  const compact = lower.replace(/[\s._-]+/g, "");

  if (!raw) {
    return "";
  }

  if (compact.includes("cursor")) {
    return "Cursor";
  }

  if (compact.includes("windsurf")) {
    return "Windsurf";
  }

  if (compact.includes("trae")) {
    return "Trae";
  }

  if (compact.includes("kiro")) {
    return "Kiro";
  }

  if (compact.includes("codebuddy")) {
    return "CodeBuddy";
  }

  if (compact.includes("antigravity")) {
    return "Antigravity";
  }

  if (compact === "zed" || compact.includes("zededitor")) {
    return "Zed";
  }

  if (compact.includes("codex")) {
    return "Codex";
  }

  if (compact === "powershell" || compact === "pwsh" || compact.includes("windowspowershell")) {
    return "PowerShell";
  }

  if (
    compact === "code" ||
    compact === "vscode" ||
    compact.includes("visualstudiocode")
  ) {
    return "Code";
  }

  return raw;
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
    ? payload.rawLines.map((item) => String(item || "").trim()).filter(Boolean)
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
  const lines = [`[${notification.sourceLabel}] notification`];

  if (notification.title) {
    lines.push(`title: ${notification.title}`);
  }

  if (notification.body) {
    lines.push(`body: ${notification.body}`);
  }

  if (!notification.title && !notification.body) {
    lines.push("body: <empty>");
  }

  lines.push(`time: ${formatTimestamp(notification.timestamp)}`);
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

function normalizeText(event) {
  return String(event.raw_message || "").trim();
}

function parseHelpCommand(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed) {
    return null;
  }

  let topic = "";
  const menuMatch = trimmed.match(/^菜单(?:\s+(.+))?$/u);

  if (menuMatch) {
    topic = menuMatch[1] || "";
  } else {
    const helpMatch = trimmed.match(/^\/?help(?:\s+(.+))?$/i);

    if (!helpMatch) {
      return null;
    }

    topic = helpMatch[1] || "";
  }

  return resolveHelpTopic(topic);
}

function resolveHelpTopic(topic) {
  const rawTopic = String(topic || "").trim();
  const lower = rawTopic.toLowerCase();

  if (!rawTopic) {
    return { kind: "home" };
  }

  if (["ide", "ides", "source", "sources"].includes(lower)) {
    return { kind: "ide-list" };
  }

  if (lower === "codex") {
    return { kind: "codex" };
  }

  if (["codex-app", "codexapp", "codex-ide", "codexide"].includes(lower)) {
    return { kind: "ide-detail", sourceLabel: "Codex" };
  }

  const sourceLabel = normalizeSourceName(rawTopic);

  if (IDE_HELP_DETAILS[sourceLabel]) {
    return { kind: "ide-detail", sourceLabel };
  }

  return { kind: "unknown", topic: rawTopic };
}

function isManagedCommandText(text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  return (
    lower === "ping" ||
    lower === "/shot" ||
    lower === "/screenshot" ||
    parseHelpCommand(trimmed) !== null ||
    lower === "/status" ||
    trimmed === STATUS_COMMAND_ZH ||
    lower.startsWith("/codex")
  );
}

function isAuthorizedPrivateMessage(event) {
  return event.message_type === "private" && String(event.user_id) === String(qqUserId);
}

function summarizePrompt(prompt, maxLength = 80) {
  const normalized = String(prompt || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function createTask(mode, prompt, sourceUserId, targetApp = "Codex") {
  taskCounter += 1;

  return {
    taskId: `task-${Date.now()}-${taskCounter}`,
    startedAt: new Date().toISOString(),
    sourceUserId: String(sourceUserId),
    promptPreview: summarizePrompt(prompt),
    targetApp,
    phase: "starting",
    mode
  };
}

function formatModeLabel(mode) {
  switch (mode) {
    case CODEX_AUTOMATION_MODES.OPEN:
      return "open";
    case CODEX_AUTOMATION_MODES.FOCUS:
      return "focus";
    case CODEX_AUTOMATION_MODES.PASTE:
      return "paste";
    case CODEX_AUTOMATION_MODES.SCREENSHOT:
      return "screenshot";
    default:
      return "send";
  }
}

function parseCodexCommand(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/codex\b([\s\S]*)$/i);

  if (!match) {
    return null;
  }

  const body = match[1].trim();

  if (!body || body.toLowerCase() === "help") {
    return {
      mode: CODEX_AUTOMATION_MODES.SEND,
      prompt: "",
      showUsage: true
    };
  }

  const [firstTokenRaw, ...rest] = body.split(/\s+/);
  const firstToken = firstTokenRaw.toLowerCase();
  const remainder = rest.join(" ").trim();

  if (firstToken === "open") {
    return { mode: CODEX_AUTOMATION_MODES.OPEN, prompt: "" };
  }

  if (firstToken === "focus") {
    return { mode: CODEX_AUTOMATION_MODES.FOCUS, prompt: "" };
  }

  if (firstToken === "paste") {
    return { mode: CODEX_AUTOMATION_MODES.PASTE, prompt: remainder };
  }

  if (firstToken === "send") {
    return { mode: CODEX_AUTOMATION_MODES.SEND, prompt: remainder };
  }

  if (firstToken === "screenshot" || firstToken === "shot") {
    return { mode: CODEX_AUTOMATION_MODES.SCREENSHOT, prompt: "" };
  }

  return { mode: CODEX_AUTOMATION_MODES.SEND, prompt: body };
}

function buildBusyRejectedMessage(task) {
  return [
    `taskId: ${task.taskId}`,
    "status: busy_rejected",
    `target: ${task.targetApp}`,
    `mode: ${formatModeLabel(task.mode)}`,
    `startedAt: ${formatTimestamp(task.startedAt)}`,
    "finishedAt: -",
    "failureReason: another Codex task is still running; no queue"
  ].join("\n");
}

function buildStatusMessage() {
  if (!currentTask) {
    return [
      `${botName} status`,
      "state: idle",
      "target: Codex"
    ].join("\n");
  }

  return [
    `${botName} status`,
    "state: busy",
    `taskId: ${currentTask.taskId}`,
    `target: ${currentTask.targetApp}`,
    `mode: ${formatModeLabel(currentTask.mode)}`,
    `phase: ${currentTask.phase}`,
    `startedAt: ${formatTimestamp(currentTask.startedAt)}`,
    `promptPreview: ${currentTask.promptPreview || "-"}`
  ].join("\n");
}

function isSourceEnabled(sourceLabel) {
  return SOURCE_ALLOWLIST.includes(sourceLabel);
}

function buildHelpHomeMessage() {
  return [
    `${botName} 帮助`,
    "总览:",
    "/help",
    "/help ide",
    "/help codex",
    "/help <ide>",
    "",
    "通用命令:",
    "ping",
    `${MENU_COMMAND_ZH} / help / /help`,
    `/status / ${STATUS_COMMAND_ZH}`,
    "",
    "Codex 自动化:",
    "/codex <prompt>",
    "/codex open",
    "/codex focus",
    "/codex screenshot",
    "/codex paste <prompt>",
    "/codex send <prompt>",
    "/shot",
    "",
    "IDE 分层入口:",
    "VS Code 系: /help code /help cursor /help windsurf /help trae /help kiro /help codebuddy /help antigravity",
    "独立编辑器: /help zed",
    "工具: /help codex-app /help powershell",
    "",
    "说明: /codex <prompt> 等同于 /codex send <prompt>；Codex 任务串行执行，不排队"
  ].join("\n");
}

function buildCodexUsage() {
  return [
    `${botName} Codex 帮助`,
    "命令:",
    "/codex open",
    "/codex focus",
    "/codex screenshot",
    "/codex paste this is a test prompt",
    "/codex send this is a test prompt",
    "/shot",
    "",
    "说明:",
    "/codex <prompt> == /codex send <prompt>",
    "仅允许白名单 QQ 私聊用户触发",
    "任务严格串行执行，忙时直接拒绝"
  ].join("\n");
}

function buildIdeListHelpMessage() {
  const lines = [`${botName} IDE 分层帮助`, "说明: 用 /help <ide> 查看单个 IDE 详情", ""];

  for (const section of IDE_HELP_SECTIONS) {
    lines.push(`${section.label}:`);

    for (const sourceLabel of section.sources) {
      const detail = IDE_HELP_DETAILS[sourceLabel];

      if (!detail) {
        continue;
      }

      lines.push(
        `- ${detail.displayName} (${isSourceEnabled(sourceLabel) ? "已启用" : "未启用"}): /help ${detail.topic}`
      );
    }

    lines.push("");
  }

  lines.push("提示: Codex 是通知源，也是 /codex 命令的自动化目标");
  return lines.join("\n");
}

function buildIdeDetailNotes(sourceLabel, detail) {
  const enabledNote = isSourceEnabled(sourceLabel)
    ? `- 当前已在 NOTIFY_SOURCE_ALLOWLIST 中启用 ${detail.displayName}`
    : `- 当前未启用 ${detail.displayName}；需要把它加入 NOTIFY_SOURCE_ALLOWLIST`;

  if (sourceLabel === "Codex") {
    return [
      "- 会转发 Codex 桌面应用的 Windows 通知到 QQ",
      "- 它同时是 /codex open|focus|paste|send 的本地自动化目标",
      "- 查看命令细节可发送 /help codex",
      enabledNote
    ];
  }

  if (sourceLabel === "PowerShell") {
    return [
      "- 会转发 PowerShell 相关的 Windows 通知到 QQ",
      "- 适合验证通知链路是否正常",
      "- 当前没有 PowerShell 专属远程命令",
      enabledNote
    ];
  }

  return [
    `- 会转发 ${detail.displayName} 的 Windows toast 到 QQ`,
    "- 该分层当前主要用于通知源说明，不会直接在该 IDE 内执行命令",
    "- 如果你想操作本地 Codex，请使用 /help codex",
    enabledNote
  ];
}

function buildIdeDetailMessage(sourceLabel) {
  const detail = IDE_HELP_DETAILS[sourceLabel];

  if (!detail) {
    return buildUnknownHelpMessage(sourceLabel);
  }

  return [
    `${botName} IDE 帮助`,
    `目标: ${detail.displayName}`,
    `分层: ${detail.section}`,
    `能力: ${detail.capability}`,
    `状态: ${isSourceEnabled(sourceLabel) ? "已启用" : "未启用"}`,
    "",
    ...buildIdeDetailNotes(sourceLabel, detail),
    "",
    "返回列表: /help ide"
  ].join("\n");
}

function buildUnknownHelpMessage(topic) {
  return [
    `${botName} 帮助`,
    `未识别主题: ${topic}`,
    "可用主题:",
    "/help",
    "/help ide",
    "/help codex",
    "/help code",
    "/help cursor",
    "/help windsurf",
    "/help trae",
    "/help kiro",
    "/help codebuddy",
    "/help antigravity",
    "/help zed",
    "/help codex-app",
    "/help powershell"
  ].join("\n");
}

function buildHelpMessage(helpCommand) {
  switch (helpCommand?.kind) {
    case "ide-list":
      return buildIdeListHelpMessage();
    case "codex":
      return buildCodexUsage();
    case "ide-detail":
      return buildIdeDetailMessage(helpCommand.sourceLabel);
    case "unknown":
      return buildUnknownHelpMessage(helpCommand.topic);
    default:
      return buildHelpHomeMessage();
  }
}

function buildTaskSummary(task, result, finishedAt) {
  return [
    `taskId: ${task.taskId}`,
    `status: ${result.success ? "success" : "failed"}`,
    `target: ${task.targetApp}`,
    `mode: ${formatModeLabel(task.mode)}`,
    `startedAt: ${formatTimestamp(task.startedAt)}`,
    `finishedAt: ${formatTimestamp(finishedAt)}`,
    `failureReason: ${result.success ? "-" : result.failureReason || "automation_failed"}`
  ].join("\n");
}

function finalizeTask(task) {
  if (currentTask?.taskId === task.taskId) {
    currentTask = null;
  }
}

async function sendPrivateText(userId, message) {
  if (!userId) {
    if (!qqTargetWarningShown) {
      qqTargetWarningShown = true;
      console.warn("[notify] QQ_USER_ID is empty, notifications and command replies will not be sent");
    }
    return false;
  }

  await client.sendPrivateText(userId, message);
  return true;
}

async function sendPrivateSegments(userId, segments) {
  if (!userId) {
    return false;
  }

  await client.sendPrivateSegments(userId, segments);
  return true;
}

async function sendScreenshotReport(userId, screenshotPath) {
  if (!screenshotPath) {
    return false;
  }

  const segments = [
    createTextSegment("current desktop screenshot"),
    createImageSegment(screenshotPath)
  ];

  try {
    await sendPrivateSegments(userId, segments);
    return true;
  } catch (error) {
    console.warn(`[task] image segment send failed, falling back to file upload: ${error.message}`);
  }

  await client.uploadPrivateFile(userId, screenshotPath, basename(screenshotPath));
  return true;
}

function handleActionOk(payload, meta) {
  const targetId = meta?.params?.user_id ?? meta?.params?.group_id ?? "unknown";
  console.log(`[bot] action ok: ${meta?.action} target=${targetId} echo=${payload.echo}`);
}

function handleActionFailed(error, meta) {
  const targetId = meta?.params?.user_id ?? meta?.params?.group_id ?? "unknown";
  const payload = error?.payload ? JSON.stringify(error.payload) : error.message;
  console.error(
    `[bot] action failed: ${meta?.action} target=${targetId} echo=${meta?.echo} response=${payload}`
  );
}

async function executeCodexTask(event, mode, prompt) {
  const task = createTask(
    mode,
    prompt,
    event.user_id,
    mode === CODEX_AUTOMATION_MODES.SCREENSHOT ? "Desktop" : "Codex"
  );
  currentTask = task;

  try {
    task.phase = "running";

    let result;

    if (mode === CODEX_AUTOMATION_MODES.SCREENSHOT) {
      try {
        const evidence = await captureDesktopEvidence({
          taskId: task.taskId,
          screenshotDir: SCREENSHOT_DIR || undefined,
          screenshotRetention: SCREENSHOT_RETENTION
        });

        result = {
          success: true,
          mode,
          failureReason: "",
          automation: null,
          screenshotPath: evidence.screenshotPath,
          screenshotError: ""
        };
      } catch (error) {
        result = {
          success: false,
          mode,
          failureReason: error.message || "capture_desktop_failed",
          automation: null,
          screenshotPath: "",
          screenshotError: error.message || "capture_desktop_failed"
        };
      }
    } else {
      result = await runCodexAutomation(prompt, {
        mode,
        taskId: task.taskId,
        timeoutMs: AUTOMATION_TIMEOUT_MS,
        screenshotDir: SCREENSHOT_DIR || undefined,
        screenshotRetention: SCREENSHOT_RETENTION
      });
    }

    task.phase = "reporting";
    const finishedAt = new Date().toISOString();

    await sendPrivateText(event.user_id, buildTaskSummary(task, result, finishedAt)).catch((error) => {
      console.error(`[task] failed to send task summary: ${error.message}`);
    });

    if (result.screenshotPath) {
      await sendScreenshotReport(event.user_id, result.screenshotPath).catch((error) => {
        console.error(`[task] failed to send screenshot report: ${error.message}`);
      });
    } else if (result.screenshotError) {
      console.warn(`[task] screenshot unavailable: ${result.screenshotError}`);
    }

    console.log(
      `[task] completed ${task.taskId} mode=${formatModeLabel(task.mode)} status=${
        result.success ? "success" : "failed"
      } reason=${result.failureReason || "-"}`
    );
  } catch (error) {
    const finishedAt = new Date().toISOString();
    console.error(`[task] unhandled task failure: ${error.message}`);

    await sendPrivateText(
      event.user_id,
      [
        `taskId: ${task.taskId}`,
        "status: failed",
        `target: ${task.targetApp}`,
        `mode: ${formatModeLabel(task.mode)}`,
        `startedAt: ${formatTimestamp(task.startedAt)}`,
        `finishedAt: ${formatTimestamp(finishedAt)}`,
        `failureReason: ${error.message || "task_failed"}`
      ].join("\n")
    ).catch((sendError) => {
      console.error(`[task] failed to send fallback summary: ${sendError.message}`);
    });
  } finally {
    finalizeTask(task);
  }
}

function handleCodexCommand(event, command) {
  if (command.showUsage) {
    sendPrivateText(event.user_id, buildCodexUsage()).catch((error) => {
      console.error(`[command] failed to send codex usage: ${error.message}`);
    });
    return;
  }

  if (
    (command.mode === CODEX_AUTOMATION_MODES.PASTE || command.mode === CODEX_AUTOMATION_MODES.SEND) &&
    !command.prompt
  ) {
    sendPrivateText(event.user_id, buildCodexUsage()).catch((error) => {
      console.error(`[command] failed to send codex usage: ${error.message}`);
    });
    return;
  }

  if (currentTask) {
    sendPrivateText(event.user_id, buildBusyRejectedMessage(currentTask)).catch((error) => {
      console.error(`[command] failed to send busy rejection: ${error.message}`);
    });
    return;
  }

  executeCodexTask(event, command.mode, command.prompt).catch((error) => {
    console.error(`[task] failed to start task: ${error.message}`);
  });
}

function handleAuthorizedCommand(event, text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const helpCommand = parseHelpCommand(trimmed);

  if (lower === "ping") {
    sendPrivateText(event.user_id, "pong").catch((error) => {
      console.error(`[command] failed to reply to ping: ${error.message}`);
    });
    return;
  }

  if (helpCommand) {
    sendPrivateText(event.user_id, buildHelpMessage(helpCommand)).catch((error) => {
      console.error(`[command] failed to send help: ${error.message}`);
    });
    return;
  }

  if (trimmed === STATUS_COMMAND_ZH || lower === "/status") {
    sendPrivateText(event.user_id, buildStatusMessage()).catch((error) => {
      console.error(`[command] failed to send status: ${error.message}`);
    });
    return;
  }

  if (lower === "/shot" || lower === "/screenshot") {
    handleCodexCommand(event, {
      mode: CODEX_AUTOMATION_MODES.SCREENSHOT,
      prompt: ""
    });
    return;
  }

  const codexCommand = parseCodexCommand(trimmed);

  if (codexCommand) {
    handleCodexCommand(event, codexCommand);
  }
}

function handleEvent(event) {
  if (event.post_type !== "message") {
    return;
  }

  const text = normalizeText(event);

  if (!text) {
    return;
  }

  if (isAuthorizedPrivateMessage(event)) {
    handleAuthorizedCommand(event, text);
    return;
  }

  if (isManagedCommandText(text)) {
    console.warn(
      `[command] ignored unauthorized command from user=${event.user_id} messageType=${event.message_type}`
    );
  }
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

  sendPrivateText(qqUserId, message)
    .then(() => {
      console.log(
        `[notify] forwarded ${notification.sourceLabel} notification: ${
          notification.title || notification.body || "<empty>"
        }`
      );
    })
    .catch((error) => {
      console.warn(
        `[notify] failed to send notification from ${notification.sourceLabel}; ${error.message}`
      );
    });
}

function handleListenerLine(line) {
  const trimmed = String(line || "").trim();

  if (!trimmed) {
    return;
  }

  try {
    const payload = JSON.parse(trimmed);
    handleNotificationPayload(payload);
  } catch {
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

function shutdown(signal) {
  console.log(`[app] received ${signal}, shutting down`);
  clearTimeout(listenerRestartTimer);

  if (listenerProcess && !listenerProcess.killed) {
    listenerProcess.kill();
  }

  client.close();
  releaseSingleInstanceLock();
  process.exit(0);
}

if (!ensureSingleInstance()) {
  process.exit(1);
}

client.on("open", (url) => {
  console.log(`[bot] connected: ${url}`);
});

client.on("close", () => {
  console.log("[bot] disconnected, retrying in 3s");
});

client.on("error", (error) => {
  console.error("[bot] websocket error", error.message);
});

client.on("invalid-payload", (error, rawPayload) => {
  console.error(`[bot] invalid payload: ${error.message} raw=${rawPayload}`);
});

client.on("event", handleEvent);
client.on("action-ok", handleActionOk);
client.on("action-failed", handleActionFailed);

process.on("exit", releaseSingleInstanceLock);
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

client.connect();
startToastListener();
