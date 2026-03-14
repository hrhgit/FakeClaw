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
  AUTOMATION_TARGET_APPS,
  DESKTOP_AUTOMATION_MODES,
  captureDesktopEvidence,
  formatTimestamp,
  listAutomationTargetConfigs,
  minimizeAutomationWindow,
  runAutomationAction,
  runDesktopAutomation
} from "./automation.js";
import { startCalibrationWebServer } from "./calibration-web.js";
import {
  createImageSegment,
  createTextSegment,
  getAuthorizedUserId,
  getPlatformBotName,
  PlatformClient,
  resolveBotPlatform
} from "./platform-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MENU_COMMAND_ZH = "\u83dc\u5355";
const STATUS_COMMAND_ZH = "\u72b6\u6001";
const AUTOMATION_TARGET_CONFIGS = listAutomationTargetConfigs();
const AUTOMATION_TARGET_DISPLAY_NAMES = Object.fromEntries(
  AUTOMATION_TARGET_CONFIGS.map(({ id, displayName }) => [id, displayName])
);

const DEFAULT_SOURCE_ALLOWLIST = [
  "Code",
  "Cursor",
  "Windsurf",
  "Trae",
  "Kiro",
  "CodeBuddy",
  "Antigravity",
  "JetBrains",
  "Zed",
  "Codex",
  "PowerShell"
];

const AUTOMATION_HELP_TOPIC_ALIASES = new Map([
  ["codex", AUTOMATION_TARGET_APPS.CODEX],
  ["codex-app", AUTOMATION_TARGET_APPS.CODEX],
  ["codexapp", AUTOMATION_TARGET_APPS.CODEX],
  ["codex-ide", AUTOMATION_TARGET_APPS.CODEX],
  ["codexide", AUTOMATION_TARGET_APPS.CODEX],
  ["vscode", AUTOMATION_TARGET_APPS.VSCODE],
  ["code", AUTOMATION_TARGET_APPS.VSCODE],
  ["vs-code", AUTOMATION_TARGET_APPS.VSCODE],
  ["visual-studio-code", AUTOMATION_TARGET_APPS.VSCODE],
  ["visualstudiocode", AUTOMATION_TARGET_APPS.VSCODE],
  ["cursor", AUTOMATION_TARGET_APPS.CURSOR],
  ["cursor-app", AUTOMATION_TARGET_APPS.CURSOR],
  ["cursorapp", AUTOMATION_TARGET_APPS.CURSOR],
  ["cursor-ide", AUTOMATION_TARGET_APPS.CURSOR],
  ["cursoride", AUTOMATION_TARGET_APPS.CURSOR],
  ["trae", AUTOMATION_TARGET_APPS.TRAE],
  ["traecn", AUTOMATION_TARGET_APPS.TRAE_CN],
  ["trae-cn", AUTOMATION_TARGET_APPS.TRAE_CN],
  ["codebuddy", AUTOMATION_TARGET_APPS.CODEBUDDY],
  ["codebuddycn", AUTOMATION_TARGET_APPS.CODEBUDDY_CN],
  ["codebuddy-cn", AUTOMATION_TARGET_APPS.CODEBUDDY_CN],
  ["antigravity", AUTOMATION_TARGET_APPS.ANTIGRAVITY],
  ["antigravity-app", AUTOMATION_TARGET_APPS.ANTIGRAVITY],
  ["antigravityapp", AUTOMATION_TARGET_APPS.ANTIGRAVITY],
  ["antigravity-ide", AUTOMATION_TARGET_APPS.ANTIGRAVITY],
  ["antigravityide", AUTOMATION_TARGET_APPS.ANTIGRAVITY]
]);

const NOTIFY_ONLY_HELP_DETAILS = {
  Windsurf: {
    displayName: "Windsurf",
    aliases: ["windsurf"]
  },
  Kiro: {
    displayName: "Kiro",
    aliases: ["kiro"]
  },
  JetBrains: {
    displayName: "JetBrains IDEs",
    aliases: [
      "jetbrains",
      "junie",
      "ai-assistant",
      "aiassistant",
      "jetbrains-ai",
      "jetbrains-ai-assistant",
      "intellij",
      "idea",
      "pycharm",
      "webstorm",
      "goland",
      "clion",
      "rider",
      "android-studio",
      "androidstudio",
      "phpstorm",
      "rubymine",
      "dataspell",
      "fleet"
    ]
  },
  Zed: {
    displayName: "Zed",
    aliases: ["zed"]
  },
  PowerShell: {
    displayName: "PowerShell",
    aliases: ["powershell", "pwsh"]
  }
};

const AUTOMATION_TARGET_CONFIGS_BY_ID = Object.fromEntries(
  AUTOMATION_TARGET_CONFIGS.map((config) => [config.id, config])
);
const AUTOMATION_COMMAND_SPECS = [
  {
    token: "open",
    mode: DESKTOP_AUTOMATION_MODES.OPEN,
    expectsPrompt: false
  },
  {
    token: "focus",
    mode: DESKTOP_AUTOMATION_MODES.FOCUS,
    expectsPrompt: false
  },
  {
    token: "minimize",
    aliases: ["mini"],
    mode: DESKTOP_AUTOMATION_MODES.MINIMIZE,
    expectsPrompt: false
  },
  {
    token: "screenshot",
    aliases: ["shot"],
    mode: DESKTOP_AUTOMATION_MODES.SCREENSHOT,
    expectsPrompt: false
  },
  {
    token: "paste",
    mode: DESKTOP_AUTOMATION_MODES.PASTE,
    expectsPrompt: true
  },
  {
    token: "send",
    mode: DESKTOP_AUTOMATION_MODES.SEND,
    expectsPrompt: true
  }
];
const AUTOMATION_TARGET_MATCH_PATTERN = AUTOMATION_TARGET_CONFIGS.map(({ id }) => escapeRegex(id)).join("|");
const NOTIFY_ONLY_HELP_TOPIC_ALIASES = new Map(
  Object.entries(NOTIFY_ONLY_HELP_DETAILS).flatMap(([sourceLabel, detail]) =>
    detail.aliases.map((alias) => [String(alias).toLowerCase(), sourceLabel])
  )
);
const AVAILABLE_HELP_TOPICS = [
  "/help",
  "/help ide",
  ...AUTOMATION_TARGET_CONFIGS.map(({ id }) => `/help ${id}`)
].filter((value, index, values) => values.indexOf(value) === index);

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
const CALIBRATION_WEB_ENABLED = process.env.CALIBRATION_WEB_ENABLED !== "false";

const botPlatform = resolveBotPlatform();
const authorizedUserId = getAuthorizedUserId(botPlatform);
const botName = getPlatformBotName(botPlatform);
const listenerScriptPath = path.resolve(__dirname, "../scripts/windows-toast-listener.ps1");
const instanceLockPath = path.resolve(__dirname, "../.fakeclaw.lock");

const client = new PlatformClient({ platform: botPlatform });
const recentNotifications = new Map();

let listenerProcess;
let listenerRestartTimer;
let targetWarningShown = false;
let instanceLockFd;
let taskCounter = 0;
let currentTask = null;
let calibrationWebServer;

function getTargetDisplayName(targetApp) {
  return AUTOMATION_TARGET_DISPLAY_NAMES[targetApp] || String(targetApp || "").trim() || "Unknown";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAutomationCommandLine(targetApp, commandSpec, promptText = "") {
  const parts = [`/${targetApp}`, commandSpec.token];

  if (commandSpec.expectsPrompt && promptText) {
    parts.push(promptText);
  }

  return parts.join(" ");
}

function getAutomationUsageCommandLines(targetApp) {
  return [
    `/${targetApp} <prompt>`,
    buildAutomationCommandLine(targetApp, { token: "paste", expectsPrompt: true }, "<prompt>"),
    buildAutomationCommandLine(targetApp, { token: "open", expectsPrompt: false }),
    buildAutomationCommandLine(targetApp, { token: "focus", expectsPrompt: false }),
    buildAutomationCommandLine(targetApp, { token: "minimize", expectsPrompt: false }),
    buildAutomationCommandLine(targetApp, { token: "screenshot", expectsPrompt: false })
  ];
}

function getAutomationHelpSummaryLines() {
  return AUTOMATION_TARGET_CONFIGS.map(
    ({ id }) => `/${id} <prompt>`
  );
}

function getAutomationExampleLine(targetApp) {
  if (targetApp === AUTOMATION_TARGET_APPS.CODEX) {
    return `/${targetApp} 帮我检查最近一次改动的风险`;
  }

  return `/${targetApp} paste 先别发送，我要手动确认`;
}

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

  if (
    compact.includes("jetbrains") ||
    compact.includes("junie") ||
    compact.includes("aiassistant") ||
    compact.includes("intellij") ||
    compact.includes("pycharm") ||
    compact.includes("webstorm") ||
    compact.includes("goland") ||
    compact.includes("clion") ||
    compact.includes("rider") ||
    compact.includes("androidstudio") ||
    compact.includes("phpstorm") ||
    compact.includes("rubymine") ||
    compact.includes("dataspell") ||
    compact.includes("fleet")
  ) {
    return "JetBrains";
  }

  if (
    compact === "zed" ||
    compact.includes("zededitor") ||
    lower.includes("dev.zed.zed") ||
    lower.includes("zed industries")
  ) {
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
    compact === "vscodeinsiders" ||
    compact === "codeinsiders" ||
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

  if (AUTOMATION_TARGET_CONFIGS_BY_ID[lower]) {
    return { kind: "automation-usage", targetApp: lower };
  }

  if (AUTOMATION_HELP_TOPIC_ALIASES.has(lower)) {
    return { kind: "automation-usage", targetApp: AUTOMATION_HELP_TOPIC_ALIASES.get(lower) };
  }

  if (NOTIFY_ONLY_HELP_TOPIC_ALIASES.has(lower)) {
    return { kind: "notify-only", sourceLabel: NOTIFY_ONLY_HELP_TOPIC_ALIASES.get(lower) };
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
    parseAutomationCommand(trimmed) !== null ||
    lower === "/status" ||
    trimmed === STATUS_COMMAND_ZH
  );
}

function isAuthorizedPrivateMessage(event) {
  return event.message_type === "private" && String(event.user_id) === String(authorizedUserId);
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
    case DESKTOP_AUTOMATION_MODES.OPEN:
      return "open";
    case DESKTOP_AUTOMATION_MODES.FOCUS:
      return "focus";
    case DESKTOP_AUTOMATION_MODES.MINIMIZE:
      return "minimize";
    case DESKTOP_AUTOMATION_MODES.PASTE:
      return "paste";
    case DESKTOP_AUTOMATION_MODES.SCREENSHOT:
      return "screenshot";
    default:
      return "send";
  }
}

function parseAutomationCommand(text) {
  const trimmed = String(text || "").trim();
  const match = AUTOMATION_TARGET_MATCH_PATTERN
    ? trimmed.match(new RegExp(`^\\/(${AUTOMATION_TARGET_MATCH_PATTERN})\\b([\\s\\S]*)$`, "i"))
    : null;

  if (!match) {
    return null;
  }

  const targetApp = String(match[1] || "")
    .trim()
    .toLowerCase();
  const body = match[2].trim();

  if (!body || body.toLowerCase() === "help") {
    return {
      targetApp,
      mode: DESKTOP_AUTOMATION_MODES.SEND,
      prompt: "",
      showUsage: true
    };
  }

  const [firstTokenRaw, ...rest] = body.split(/\s+/);
  const firstToken = firstTokenRaw.toLowerCase();
  const remainder = rest.join(" ").trim();

  const commandSpec = AUTOMATION_COMMAND_SPECS.find(({ token, aliases = [] }) =>
    [token, ...aliases].includes(firstToken)
  );

  if (commandSpec) {
    return {
      targetApp,
      mode: commandSpec.mode,
      prompt: commandSpec.expectsPrompt ? remainder : "",
      openBeforeScreenshot: commandSpec.mode === DESKTOP_AUTOMATION_MODES.SCREENSHOT
    };
  }

  return { targetApp, mode: DESKTOP_AUTOMATION_MODES.SEND, prompt: body };
}

function buildBusyRejectedMessage(task) {
  return [
    `taskId: ${task.taskId}`,
    "status: busy_rejected",
    `target: ${task.targetApp}`,
    `mode: ${formatModeLabel(task.mode)}`,
    `startedAt: ${formatTimestamp(task.startedAt)}`,
    "finishedAt: -",
    "failureReason: another automation task is still running; no queue"
  ].join("\n");
}

function buildStatusMessage() {
  if (!currentTask) {
    return [
      `${botName} status`,
      "state: idle",
      `targets: ${AUTOMATION_TARGET_CONFIGS.map(({ displayName }) => displayName).join(", ")}`
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
  const lines = [
    `${botName} 帮助`,
    "通用命令:",
    "ping",
    "/status",
    "/shot",
    "",
    "可操作目标:",
    ...getAutomationHelpSummaryLines(),
    "",
    "查看细节:",
    ...AUTOMATION_TARGET_CONFIGS.map(({ id }) => `/help ${id}`),
    "",
    `入口别名: ${MENU_COMMAND_ZH} / help / /help`
  ];

  return lines.join("\n");
}

function buildAutomationUsage(targetApp) {
  const displayName = getTargetDisplayName(targetApp);
  const lines = [
    `${botName} ${displayName} 帮助`,
    "命令:",
    ...getAutomationUsageCommandLines(targetApp),
    "",
    "注意:",
    `/${targetApp} <prompt> 等同 /${targetApp} send <prompt>；send 成功后会自动最小化窗口`
  ];

  if (
    targetApp === AUTOMATION_TARGET_APPS.VSCODE ||
    targetApp === AUTOMATION_TARGET_APPS.CURSOR ||
    targetApp === AUTOMATION_TARGET_APPS.TRAE ||
    targetApp === AUTOMATION_TARGET_APPS.TRAE_CN ||
    targetApp === AUTOMATION_TARGET_APPS.CODEBUDDY ||
    targetApp === AUTOMATION_TARGET_APPS.CODEBUDDY_CN ||
    targetApp === AUTOMATION_TARGET_APPS.ANTIGRAVITY
  ) {
    lines.push(`默认尝试命中 ${displayName} 窗口右侧下方聊天输入框；如果你改了面板布局，focus/paste/send 可能失败`);
  } else {
    lines.push("默认先匹配底部编辑器容器，再执行点击、粘贴和发送");
  }

  lines.push("", "示例:", getAutomationExampleLine(targetApp));

  return lines.join("\n");
}

function buildIdeListHelpMessage() {
  return buildHelpHomeMessage();
}

function buildNotifyOnlyHelpMessage(sourceLabel) {
  const detail = NOTIFY_ONLY_HELP_DETAILS[sourceLabel];

  if (!detail) {
    return buildUnknownHelpMessage(sourceLabel);
  }

  const lines = [
    `${botName} ${detail.displayName} 帮助`,
    "能力: 仅通知转发",
    `状态: ${isSourceEnabled(sourceLabel) ? "已启用" : "未启用"}`,
    "",
    `- ${detail.displayName} 目前只作为 Windows 通知来源转发到当前消息入口`,
    "- 当前没有远程自动化命令",
    `- 如果你想操作本地 IDE，请使用 ${AUTOMATION_TARGET_CONFIGS.map(({ id }) => `/help ${id}`).join("、")}`
  ];

  if (sourceLabel === "JetBrains") {
    lines.push("- 包括 JetBrains AI Assistant / Junie，以及 IntelliJ IDEA、PyCharm、WebStorm 等宿主 IDE 的通知");
  }

  lines.push("", "返回总览: /help");
  return lines.join("\n");
}

function buildUnknownHelpMessage(topic) {
  return [
    `${botName} 帮助`,
    `未识别主题: ${topic}`,
    "可用主题:",
    ...AVAILABLE_HELP_TOPICS
  ].join("\n");
}

function buildHelpMessage(helpCommand) {
  switch (helpCommand?.kind) {
    case "ide-list":
      return buildIdeListHelpMessage();
    case "automation-usage":
      return buildAutomationUsage(helpCommand.targetApp);
    case "notify-only":
      return buildNotifyOnlyHelpMessage(helpCommand.sourceLabel);
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
    if (!targetWarningShown) {
      targetWarningShown = true;
      console.warn("[notify] target user id is empty, notifications and command replies will not be sent");
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

async function executeAutomationTask(event, targetApp, mode, prompt, options = {}) {
  const openBeforeScreenshot = options.openBeforeScreenshot === true;
  const task = createTask(
    mode,
    prompt,
    event.user_id,
    mode === DESKTOP_AUTOMATION_MODES.SCREENSHOT && !openBeforeScreenshot
      ? "Desktop"
      : getTargetDisplayName(targetApp)
  );
  currentTask = task;

  try {
    task.phase = "running";

    let result;

    if (mode === DESKTOP_AUTOMATION_MODES.SCREENSHOT) {
      try {
        let automation = null;

        if (openBeforeScreenshot) {
          automation = await runAutomationAction(targetApp, {
            mode: DESKTOP_AUTOMATION_MODES.OPEN,
            timeoutMs: AUTOMATION_TIMEOUT_MS
          });

          if (automation?.status !== "success") {
            result = {
              success: false,
              targetApp,
              mode,
              failureReason: automation?.failureReason || "automation_failed",
              automation,
              screenshotPath: "",
              screenshotError: ""
            };

            throw new Error("__screenshot_open_failed__");
          }
        }

        const evidence = await captureDesktopEvidence({
          taskId: task.taskId,
          screenshotDir: SCREENSHOT_DIR || undefined,
          screenshotRetention: SCREENSHOT_RETENTION
        });

        result = {
          success: true,
          targetApp,
          mode,
          failureReason: "",
          automation,
          screenshotPath: evidence.screenshotPath,
          screenshotError: ""
        };
      } catch (error) {
        if (error.message !== "__screenshot_open_failed__") {
          result = {
            success: false,
            targetApp,
            mode,
            failureReason: error.message || "capture_desktop_failed",
            automation: null,
            screenshotPath: "",
            screenshotError: error.message || "capture_desktop_failed"
          };
        }
      }
    } else if (mode === DESKTOP_AUTOMATION_MODES.MINIMIZE) {
      try {
        const automation = await minimizeAutomationWindow(targetApp);

        result = {
          success: automation.status === "success" || automation.status === "noop",
          targetApp,
          mode,
          failureReason: "",
          automation,
          screenshotPath: "",
          screenshotError: ""
        };
      } catch (error) {
        result = {
          success: false,
          targetApp,
          mode,
          failureReason: error.message || "minimize_failed",
          automation: null,
          screenshotPath: "",
          screenshotError: ""
        };
      }
    } else {
      result = await runDesktopAutomation(targetApp, prompt, {
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
      `[task] completed ${task.taskId} target=${getTargetDisplayName(targetApp)} mode=${formatModeLabel(
        task.mode
      )} status=${result.success ? "success" : "failed"} reason=${result.failureReason || "-"}`
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

function handleAutomationCommand(event, command) {
  if (command.showUsage) {
    sendPrivateText(event.user_id, buildAutomationUsage(command.targetApp)).catch((error) => {
      console.error(`[command] failed to send automation usage: ${error.message}`);
    });
    return;
  }

  if (
    (command.mode === DESKTOP_AUTOMATION_MODES.PASTE ||
      command.mode === DESKTOP_AUTOMATION_MODES.SEND) &&
    !command.prompt
  ) {
    sendPrivateText(event.user_id, buildAutomationUsage(command.targetApp)).catch((error) => {
      console.error(`[command] failed to send automation usage: ${error.message}`);
    });
    return;
  }

  if (currentTask) {
    sendPrivateText(event.user_id, buildBusyRejectedMessage(currentTask)).catch((error) => {
      console.error(`[command] failed to send busy rejection: ${error.message}`);
    });
    return;
  }

  executeAutomationTask(event, command.targetApp, command.mode, command.prompt, {
    openBeforeScreenshot: command.openBeforeScreenshot === true
  }).catch((error) => {
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
    handleAutomationCommand(event, {
      targetApp: AUTOMATION_TARGET_APPS.CODEX,
      mode: DESKTOP_AUTOMATION_MODES.SCREENSHOT,
      prompt: ""
    });
    return;
  }

  const automationCommand = parseAutomationCommand(trimmed);

  if (automationCommand) {
    handleAutomationCommand(event, automationCommand);
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

  sendPrivateText(authorizedUserId, message)
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

  if (calibrationWebServer) {
    calibrationWebServer.close();
    calibrationWebServer = undefined;
  }

  client.close();
  releaseSingleInstanceLock();
  process.exit(0);
}

if (!ensureSingleInstance()) {
  process.exit(1);
}

client.on("open", (url) => {
  console.log(`[bot] ${botPlatform} connected: ${url}`);
});

client.on("close", () => {
  console.log(`[bot] ${botPlatform} disconnected`);
});

client.on("error", (error) => {
  console.error(`[bot] ${botPlatform} error`, error.message);
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

if (CALIBRATION_WEB_ENABLED) {
  calibrationWebServer = startCalibrationWebServer({
    isAutomationBusy: () => currentTask !== null
  });
}

client.connect();
startToastListener();
