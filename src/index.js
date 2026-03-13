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
  runDesktopAutomation
} from "./automation.js";
import { startCalibrationWebServer } from "./calibration-web.js";
import { createImageSegment, createTextSegment, NapCatClient } from "./napcat-client.js";

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

const IDE_HELP_SECTIONS = [
  {
    label: "VS Code 系",
    sources: ["Code", "Cursor", "Windsurf", "Trae", "Kiro", "CodeBuddy", "Antigravity"]
  },
  {
    label: "独立编辑器",
    sources: ["JetBrains", "Zed"]
  },
  {
    label: "自动化目标",
    sources: ["Codex", "Cursor", "Trae", "CodeBuddy", "Antigravity"]
  },
  {
    label: "终端工具",
    sources: ["PowerShell"]
  }
];

const IDE_HELP_DETAILS = {
  Code: {
    topic: "code",
    aliases: ["code"],
    displayName: "VS Code",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Cursor: {
    topic: "cursor-app",
    aliases: ["cursor-app", "cursorapp", "cursor-ide", "cursoride"],
    displayName: "Cursor",
    section: "自动化目标",
    capability: "通知转发 + 本地自动化目标"
  },
  Windsurf: {
    topic: "windsurf",
    aliases: ["windsurf"],
    displayName: "Windsurf",
    section: "VS Code 系",
    capability: "通知转发"
  },
  Trae: {
    topic: "trae",
    aliases: ["trae"],
    displayName: "Trae",
    section: "自动化目标",
    capability: "通知转发 + 本地自动化目标"
  },
  Kiro: {
    topic: "kiro",
    aliases: ["kiro"],
    displayName: "Kiro",
    section: "VS Code 系",
    capability: "通知转发"
  },
  CodeBuddy: {
    topic: "codebuddy",
    aliases: ["codebuddy"],
    displayName: "CodeBuddy",
    section: "VS Code 系",
    capability: "通知转发 + 本地自动化目标"
  },
  Antigravity: {
    topic: "antigravity-app",
    aliases: [
      "antigravity-app",
      "antigravityapp",
      "antigravity-ide",
      "antigravityide"
    ],
    displayName: "Antigravity",
    section: "自动化目标",
    capability: "通知转发 + 本地自动化目标"
  },
  JetBrains: {
    topic: "jetbrains",
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
    ],
    displayName: "JetBrains IDEs",
    section: "独立编辑器",
    capability: "通知转发"
  },
  Zed: {
    topic: "zed",
    aliases: ["zed"],
    displayName: "Zed",
    section: "独立编辑器",
    capability: "通知转发"
  },
  Codex: {
    topic: "codex-app",
    aliases: ["codex-app", "codexapp", "codex-ide", "codexide"],
    displayName: "Codex",
    section: "自动化目标",
    capability: "通知转发 + 本地自动化目标"
  },
  PowerShell: {
    topic: "powershell",
    aliases: ["powershell"],
    displayName: "PowerShell",
    section: "终端工具",
    capability: "通知转发"
  }
};

const AUTOMATION_TARGET_CONFIGS_BY_ID = Object.fromEntries(
  AUTOMATION_TARGET_CONFIGS.map((config) => [config.id, config])
);
const AUTOMATION_TARGET_CONFIGS_BY_SOURCE = Object.fromEntries(
  AUTOMATION_TARGET_CONFIGS.map((config) => [config.displayName, config])
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
const IDE_HELP_TOPIC_ALIASES = new Map(
  Object.entries(IDE_HELP_DETAILS).flatMap(([sourceLabel, detail]) =>
    (detail.aliases || [detail.topic]).map((alias) => [String(alias).toLowerCase(), sourceLabel])
  )
);
const AVAILABLE_HELP_TOPICS = [
  "/help",
  "/help ide",
  ...AUTOMATION_TARGET_CONFIGS.map(({ id }) => `/help ${id}`),
  ...Object.values(IDE_HELP_DETAILS).map(({ topic }) => `/help ${topic}`)
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

function getAutomationHomeCommandLines(targetApp) {
  return [
    `/${targetApp} <prompt>`,
    ...AUTOMATION_COMMAND_SPECS.map((commandSpec) =>
      buildAutomationCommandLine(targetApp, commandSpec, commandSpec.expectsPrompt ? "<prompt>" : "")
    )
  ];
}

function getAutomationUsageCommandLines(targetApp) {
  return [
    ...AUTOMATION_COMMAND_SPECS.map((commandSpec) =>
      buildAutomationCommandLine(
        targetApp,
        commandSpec,
        commandSpec.expectsPrompt ? "this is a test prompt" : ""
      )
    ),
    `/${targetApp} <prompt>`
  ];
}

function getAutomationActionSummary(targetApp) {
  const tokens = AUTOMATION_COMMAND_SPECS.map(({ token }) => token).join("|");
  return `/${targetApp} <prompt>、/${targetApp} ${tokens}`;
}

function getIdeHelpSectionSummaryLines() {
  return IDE_HELP_SECTIONS.map((section) => {
    const topics = section.sources
      .map((sourceLabel) => IDE_HELP_DETAILS[sourceLabel]?.topic)
      .filter(Boolean)
      .map((topic) => `/help ${topic}`);

    return topics.length ? `${section.label}: ${topics.join(" ")}` : null;
  }).filter(Boolean);
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

  if (IDE_HELP_TOPIC_ALIASES.has(lower)) {
    return { kind: "ide-detail", sourceLabel: IDE_HELP_TOPIC_ALIASES.get(lower) };
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
    parseAutomationCommand(trimmed) !== null ||
    lower === "/status" ||
    trimmed === STATUS_COMMAND_ZH
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
    case DESKTOP_AUTOMATION_MODES.OPEN:
      return "open";
    case DESKTOP_AUTOMATION_MODES.FOCUS:
      return "focus";
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
      prompt: commandSpec.expectsPrompt ? remainder : ""
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
    "总览:",
    "/help",
    "/help ide",
    ...AUTOMATION_TARGET_CONFIGS.map(({ id }) => `/help ${id}`),
    "/help <ide>",
    "",
    "通用命令:",
    "ping",
    `${MENU_COMMAND_ZH} / help / /help`,
    `/status / ${STATUS_COMMAND_ZH}`,
    "/shot",
    ""
  ];

  for (const { id, displayName } of AUTOMATION_TARGET_CONFIGS) {
    lines.push(`${displayName} 自动化:`);
    lines.push(...getAutomationHomeCommandLines(id));
    lines.push("");
  }

  lines.push(
    "IDE 分层入口:",
    ...getIdeHelpSectionSummaryLines(),
    "",
    `说明: ${AUTOMATION_TARGET_CONFIGS.map(({ id }) => `/${id} <prompt>`).join("、")} 都等同于 send；任务串行执行，不排队`
  );

  return lines.join("\n");
}

function buildAutomationUsage(targetApp) {
  const displayName = getTargetDisplayName(targetApp);
  const lines = [
    `${botName} ${displayName} 帮助`,
    "命令:",
    ...getAutomationUsageCommandLines(targetApp),
    "/shot",
    "",
    "说明:",
    `/${targetApp} <prompt> == /${targetApp} send <prompt>`,
    "仅允许白名单 QQ 私聊用户触发",
    "任务严格串行执行，忙时直接拒绝"
  ];

  if (
    targetApp === AUTOMATION_TARGET_APPS.CURSOR ||
    targetApp === AUTOMATION_TARGET_APPS.TRAE ||
    targetApp === AUTOMATION_TARGET_APPS.TRAE_CN ||
    targetApp === AUTOMATION_TARGET_APPS.CODEBUDDY ||
    targetApp === AUTOMATION_TARGET_APPS.CODEBUDDY_CN ||
    targetApp === AUTOMATION_TARGET_APPS.ANTIGRAVITY
  ) {
    lines.push(`当前 ${displayName} 流程默认尝试定位窗口右侧下方聊天输入框`);
    lines.push("如果你把聊天面板移动到别处，focus/paste/send 可能会失败");
  } else {
    lines.push("Codex 流程优先匹配底部编辑器容器，再执行点击、粘贴和发送");
  }

  return lines.join("\n");
}

function buildIdeListHelpMessage() {
  const lines = [`${botName} IDE 分层帮助`, "说明: 用 /help <topic> 查看单个入口详情", ""];

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

  lines.push(
    `提示: ${AUTOMATION_TARGET_CONFIGS.map(({ displayName }) => displayName).join("、")} 既是通知源，也是远程自动化目标`
  );
  return lines.join("\n");
}

function buildIdeDetailNotes(sourceLabel, detail) {
  const enabledNote = isSourceEnabled(sourceLabel)
    ? `- 当前已在 NOTIFY_SOURCE_ALLOWLIST 中启用 ${detail.displayName}`
    : `- 当前未启用 ${detail.displayName}；需要把它加入 NOTIFY_SOURCE_ALLOWLIST`;

  const automationTarget = AUTOMATION_TARGET_CONFIGS_BY_SOURCE[sourceLabel];

  if (automationTarget) {
    const notes = [
      `- 会转发 ${detail.displayName} 的 Windows 通知到 QQ`,
      `- 它同时支持 ${getAutomationActionSummary(automationTarget.id)}`,
      `- 查看命令细节可发送 /help ${automationTarget.id}`
    ];

    if (
      automationTarget.id === AUTOMATION_TARGET_APPS.CURSOR ||
      automationTarget.id === AUTOMATION_TARGET_APPS.TRAE ||
      automationTarget.id === AUTOMATION_TARGET_APPS.TRAE_CN ||
      automationTarget.id === AUTOMATION_TARGET_APPS.CODEBUDDY ||
      automationTarget.id === AUTOMATION_TARGET_APPS.CODEBUDDY_CN ||
      automationTarget.id === AUTOMATION_TARGET_APPS.ANTIGRAVITY
    ) {
      notes.splice(2, 0, "- 当前自动化默认尝试命中右侧下方聊天输入框");
    } else if (automationTarget.id === AUTOMATION_TARGET_APPS.CODEX) {
      notes.splice(2, 0, "- 当前自动化会优先匹配底部编辑器容器后再执行输入和发送");
    }

    notes.push(enabledNote);
    return notes;
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
    `- 如果你想操作本地 ${AUTOMATION_TARGET_CONFIGS.map(({ displayName }) => displayName).join("、")}，请使用对应的 /help 命令`,
    sourceLabel === "JetBrains"
      ? "- 包括 JetBrains AI Assistant / Junie，以及 IntelliJ IDEA、PyCharm、WebStorm 等宿主 IDE 的通知"
      : null,
    enabledNote
  ].filter(Boolean);
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
    ...AVAILABLE_HELP_TOPICS
  ].join("\n");
}

function buildHelpMessage(helpCommand) {
  switch (helpCommand?.kind) {
    case "ide-list":
      return buildIdeListHelpMessage();
    case "automation-usage":
      return buildAutomationUsage(helpCommand.targetApp);
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

async function executeAutomationTask(event, targetApp, mode, prompt) {
  const task = createTask(
    mode,
    prompt,
    event.user_id,
    mode === DESKTOP_AUTOMATION_MODES.SCREENSHOT ? "Desktop" : getTargetDisplayName(targetApp)
  );
  currentTask = task;

  try {
    task.phase = "running";

    let result;

    if (mode === DESKTOP_AUTOMATION_MODES.SCREENSHOT) {
      try {
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
          automation: null,
          screenshotPath: evidence.screenshotPath,
          screenshotError: ""
        };
      } catch (error) {
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

  executeAutomationTask(event, command.targetApp, command.mode, command.prompt).catch((error) => {
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

if (CALIBRATION_WEB_ENABLED) {
  calibrationWebServer = startCalibrationWebServer({
    isAutomationBusy: () => currentTask !== null
  });
}

client.connect();
startToastListener();
