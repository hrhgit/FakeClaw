import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AUTOMATION_TIMEOUT_MS = 30000;
const DEFAULT_SCREENSHOT_RETENTION = 20;
const DEFAULT_SCREENSHOT_AFTER_ACTION_DELAY_MS = 1200;
const DEFAULT_SCREENSHOT_DIR = path.join(os.tmpdir(), "fakeclaw-screenshots");
const DEFAULT_CODEX_LAUNCH_COMMAND = "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App";
const POWERSHELL_PATH = process.env.POWERSHELL_PATH || "powershell.exe";
const AUTOMATION_SCRIPT_PATH = path.resolve(__dirname, "../scripts/codex-automation.ps1");
const SCREENSHOT_SCRIPT_PATH = path.resolve(__dirname, "../scripts/capture-desktop-screenshot.ps1");
const MINIMIZE_WINDOW_SCRIPT_PATH = path.resolve(__dirname, "../scripts/minimize-codex-window.ps1");

export const AUTOMATION_TARGET_APPS = {
  CODEX: "codex",
  CURSOR: "cursor"
};

export const DESKTOP_AUTOMATION_MODES = {
  OPEN: "open",
  FOCUS: "focus",
  PASTE: "paste",
  SEND: "send",
  SCREENSHOT: "screenshot"
};

const TARGET_APP_CONFIG = {
  [AUTOMATION_TARGET_APPS.CODEX]: {
    id: AUTOMATION_TARGET_APPS.CODEX,
    displayName: "Codex",
    launchCommandEnv: "CODEX_LAUNCH_COMMAND",
    defaultLaunchCommand: DEFAULT_CODEX_LAUNCH_COMMAND
  },
  [AUTOMATION_TARGET_APPS.CURSOR]: {
    id: AUTOMATION_TARGET_APPS.CURSOR,
    displayName: "Cursor",
    launchCommandEnv: "CURSOR_LAUNCH_COMMAND",
    defaultLaunchCommand: ""
  }
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveScreenshotDelayMs(mode, value) {
  if (mode !== DESKTOP_AUTOMATION_MODES.PASTE && mode !== DESKTOP_AUTOMATION_MODES.SEND) {
    return 0;
  }

  return toNonNegativeNumber(value, DEFAULT_SCREENSHOT_AFTER_ACTION_DELAY_MS);
}

function resolveTargetAppConfig(targetApp = AUTOMATION_TARGET_APPS.CODEX) {
  const normalized = String(targetApp || "")
    .trim()
    .toLowerCase();
  const config = TARGET_APP_CONFIG[normalized];

  if (!config) {
    throw new Error(`unsupported_target_app: ${targetApp}`);
  }

  return config;
}

function buildPowerShellArgs(scriptPath, params, { sta = false } = {}) {
  const args = ["-NoProfile"];

  if (sta) {
    args.push("-STA");
  }

  args.push("-ExecutionPolicy", "Bypass", "-File", scriptPath);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    args.push(`-${key}`, String(value));
  }

  return args;
}

function parseJsonOutput(stdout, stderr) {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error(stderr.trim() || "PowerShell script produced no JSON output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid JSON output: ${trimmed}`);
  }
}

function runPowerShellScript(scriptPath, params, { timeoutMs, sta = false } = {}) {
  const args = buildPowerShellArgs(scriptPath, params, { sta });

  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL_PATH, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`PowerShell script timeout: ${path.basename(scriptPath)}`));
    }, toNumber(timeoutMs, DEFAULT_AUTOMATION_TIMEOUT_MS));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
        return;
      }

      try {
        resolve(parseJsonOutput(stdout, stderr));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function ensureScreenshotDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function cleanupOldScreenshots(dirPath, retention) {
  const limit = toNumber(retention, DEFAULT_SCREENSHOT_RETENTION);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => path.join(dirPath, entry.name));

  if (files.length <= limit) {
    return;
  }

  const stats = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      mtimeMs: (await stat(filePath)).mtimeMs
    }))
  );

  stats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const staleFiles = stats.slice(limit);

  await Promise.all(
    staleFiles.map(({ filePath }) =>
      rm(filePath, {
        force: true
      })
    )
  );
}

export async function captureDesktopEvidence({
  taskId,
  screenshotDir = process.env.SCREENSHOT_DIR || DEFAULT_SCREENSHOT_DIR,
  screenshotRetention = process.env.SCREENSHOT_RETENTION || DEFAULT_SCREENSHOT_RETENTION
}) {
  await ensureScreenshotDir(screenshotDir);

  const screenshotPath = path.join(
    screenshotDir,
    `${taskId}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
  );

  const payload = await runPowerShellScript(
    SCREENSHOT_SCRIPT_PATH,
    { OutputPath: screenshotPath },
    { timeoutMs: 10000, sta: true }
  );

  if (payload.status !== "success") {
    throw new Error(payload.failureReason || "capture_desktop_failed");
  }

  await cleanupOldScreenshots(screenshotDir, screenshotRetention);

  return {
    screenshotPath: payload.path || screenshotPath,
    payload
  };
}

async function minimizeAppWindow(targetApp) {
  const config = resolveTargetAppConfig(targetApp);
  const payload = await runPowerShellScript(
    MINIMIZE_WINDOW_SCRIPT_PATH,
    { TargetApp: config.id },
    { timeoutMs: 5000, sta: true }
  );

  if (payload.status === "failed") {
    throw new Error(payload.failureReason || `minimize_${config.id}_failed`);
  }

  return payload;
}

export async function runDesktopAutomation(targetApp, prompt, options = {}) {
  const config = resolveTargetAppConfig(targetApp);
  const launchCommand =
    options.launchCommand ||
    process.env[config.launchCommandEnv] ||
    config.defaultLaunchCommand;
  const timeoutMs = toNumber(
    options.timeoutMs || process.env.AUTOMATION_TIMEOUT_MS,
    DEFAULT_AUTOMATION_TIMEOUT_MS
  );
  const taskId = options.taskId || `task-${Date.now()}`;
  const mode = options.mode || DESKTOP_AUTOMATION_MODES.SEND;
  const screenshotDelayMs = resolveScreenshotDelayMs(
    mode,
    options.screenshotDelayMs ?? process.env.SCREENSHOT_AFTER_ACTION_DELAY_MS
  );

  let automation;
  let failureReason = "";

  try {
    automation = await runPowerShellScript(
      AUTOMATION_SCRIPT_PATH,
      {
        Prompt: prompt,
        LaunchCommand: launchCommand,
        Mode: mode,
        TargetApp: config.id
      },
      {
        timeoutMs,
        sta: true
      }
    );
  } catch (error) {
    failureReason = error.message || "automation_error";
    automation = {
      status: "failed",
      failureReason
    };
  }

  let evidence;
  let screenshotError = "";

  try {
    if (automation?.status === "success" && screenshotDelayMs > 0) {
      await sleep(screenshotDelayMs);
    }

    evidence = await captureDesktopEvidence({
      taskId,
      screenshotDir: options.screenshotDir,
      screenshotRetention: options.screenshotRetention
    });
  } catch (error) {
    screenshotError = error.message || "screenshot_failed";
  }

  try {
    await minimizeAppWindow(config.id);
  } catch (error) {
    console.warn(`[automation] failed to minimize ${config.displayName} window: ${error.message}`);
  }

  const success = automation?.status === "success";

  return {
    success,
    targetApp: config.id,
    mode,
    failureReason: success ? "" : automation?.failureReason || failureReason || "automation_failed",
    automation,
    screenshotPath: evidence?.screenshotPath || "",
    screenshotError
  };
}

export async function runCodexAutomation(prompt, options = {}) {
  return runDesktopAutomation(AUTOMATION_TARGET_APPS.CODEX, prompt, options);
}

export function formatTimestamp(value) {
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
