import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_APP_NAME = "FakeClaw";
const DEFAULT_LOCAL_APPDATA = path.join(os.homedir(), "AppData", "Local");
const LOCAL_APPDATA_ROOT = process.env.LOCALAPPDATA || DEFAULT_LOCAL_APPDATA;
const DEFAULT_USER_DATA_ROOT = path.join(LOCAL_APPDATA_ROOT, DEFAULT_APP_NAME);
const ENV_TEMPLATE_PATH = path.join(APP_ROOT, ".env.example");
const BUNDLED_AUTOMATION_CONFIG_PATH = path.join(APP_ROOT, "config", "desktop-automation.config.json");

function hasLocalWorkspaceEnv() {
  return existsSync(path.join(APP_ROOT, ".env"));
}

function resolveDataRoot() {
  const explicitDataRoot = String(process.env.FAKECLAW_DATA_DIR || "").trim();

  if (explicitDataRoot) {
    return path.resolve(explicitDataRoot);
  }

  if (hasLocalWorkspaceEnv()) {
    return APP_ROOT;
  }

  return DEFAULT_USER_DATA_ROOT;
}

function applyDefaultEnvOverrides(rawTemplate) {
  const lines = String(rawTemplate || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  let botPlatformSeen = false;
  let botNameSeen = false;

  const nextLines = lines.map((line) => {
    if (/^\s*BOT_PLATFORM\s*=/.test(line)) {
      botPlatformSeen = true;
      return "BOT_PLATFORM=none";
    }

    if (/^\s*BOT_NAME\s*=/.test(line)) {
      botNameSeen = true;
      return "BOT_NAME=FakeClaw";
    }

    return line;
  });

  if (!botPlatformSeen) {
    nextLines.unshift("BOT_PLATFORM=none");
  }

  if (!botNameSeen) {
    nextLines.splice(Math.min(1, nextLines.length), 0, "BOT_NAME=FakeClaw");
  }

  return `${nextLines.join("\n").trimEnd()}\n`;
}

export { APP_ROOT };

export const DATA_ROOT = resolveDataRoot();
export const ENV_FILE_PATH = path.join(DATA_ROOT, ".env");
export const USER_CONFIG_ROOT = path.join(DATA_ROOT, "config");
export const USER_AUTOMATION_CONFIG_PATH = path.join(
  USER_CONFIG_ROOT,
  "desktop-automation.config.json"
);
export const SCREENSHOT_ROOT = path.join(DATA_ROOT, "screenshots");

dotenv.config({
  path: ENV_FILE_PATH,
  override: false
});

export function resolveRuntimePath(...segments) {
  return path.join(APP_ROOT, ...segments);
}

export function resolveDataPath(...segments) {
  return path.join(DATA_ROOT, ...segments);
}

export function resolveDesktopAutomationConfigPath(explicitPath = "") {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (existsSync(USER_AUTOMATION_CONFIG_PATH)) {
    return USER_AUTOMATION_CONFIG_PATH;
  }

  return BUNDLED_AUTOMATION_CONFIG_PATH;
}

export async function ensureRuntimeDataLayout() {
  await mkdir(DATA_ROOT, { recursive: true });
  await mkdir(USER_CONFIG_ROOT, { recursive: true });
  await mkdir(SCREENSHOT_ROOT, { recursive: true });

  if (!existsSync(ENV_FILE_PATH)) {
    if (existsSync(ENV_TEMPLATE_PATH)) {
      const template = await readFile(ENV_TEMPLATE_PATH, "utf8");
      await writeFile(ENV_FILE_PATH, applyDefaultEnvOverrides(template), "utf8");
    } else {
      await writeFile(ENV_FILE_PATH, "BOT_PLATFORM=none\nBOT_NAME=FakeClaw\n", "utf8");
    }
  }

  if (!existsSync(USER_AUTOMATION_CONFIG_PATH) && existsSync(BUNDLED_AUTOMATION_CONFIG_PATH)) {
    await copyFile(BUNDLED_AUTOMATION_CONFIG_PATH, USER_AUTOMATION_CONFIG_PATH);
  }
}
