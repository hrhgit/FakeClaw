import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  DESKTOP_AUTOMATION_MODES,
  AUTOMATION_TARGET_APPS,
  getDesktopAutomationConfigPath,
  listAutomationTargetConfigs,
  minimizeAutomationWindow,
  resolveTargetAppConfig,
  runAutomationAction,
  runCalibrationAnalysis
} from "./automation.js";
import {
  USER_AUTOMATION_CONFIG_PATH,
  ensureRuntimeDataLayout,
  resolveDesktopAutomationConfigPath
} from "./app-runtime.js";

const CALIBRATION_TARGETS = new Set([
  AUTOMATION_TARGET_APPS.CODEX,
  AUTOMATION_TARGET_APPS.VSCODE,
  AUTOMATION_TARGET_APPS.CURSOR,
  AUTOMATION_TARGET_APPS.TRAE,
  AUTOMATION_TARGET_APPS.TRAE_CN,
  AUTOMATION_TARGET_APPS.CODEBUDDY,
  AUTOMATION_TARGET_APPS.CODEBUDDY_CN,
  AUTOMATION_TARGET_APPS.ANTIGRAVITY
]);

function resolveComposerConfigTarget(targetApp) {
  switch (targetApp) {
    case AUTOMATION_TARGET_APPS.TRAE_CN:
      return AUTOMATION_TARGET_APPS.TRAE;
    case AUTOMATION_TARGET_APPS.CODEBUDDY_CN:
      return AUTOMATION_TARGET_APPS.CODEBUDDY;
    default:
      return targetApp;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

async function tryMinimizeTargetWindow(targetApp) {
  try {
    await minimizeAutomationWindow(targetApp);
  } catch (error) {
    console.warn(`[calibration] failed to minimize ${targetApp}: ${error.message}`);
  }
}

function ensureObjectNode(parent, key) {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) {
    parent[key] = {};
  }

  return parent[key];
}

function normalizeComposerSearch(composerSearch) {
  if (!composerSearch || typeof composerSearch !== "object" || Array.isArray(composerSearch)) {
    return {};
  }

  const entries = Object.entries(composerSearch || {}).filter(([, value]) =>
    Number.isFinite(Number(value))
  );

  if (entries.length === 0) {
    return {};
  }

  return Object.fromEntries(
    entries.map(([key, value]) => {
      const numeric = Number(value);
      return [key, Number.isInteger(numeric) ? numeric : Number(numeric.toFixed(3))];
    })
  );
}

function normalizeClickFallback(clickFallback) {
  if (!clickFallback || typeof clickFallback !== "object" || Array.isArray(clickFallback)) {
    return {};
  }

  const entries = Object.entries(clickFallback).filter(([, value]) =>
    Number.isFinite(Number(value))
  );

  return Object.fromEntries(
    entries.map(([key, value]) => {
      const numeric = Number(value);
      return [key, Number.isInteger(numeric) ? numeric : Number(numeric.toFixed(3))];
    })
  );
}

export async function readDesktopAutomationConfig() {
  const configPath = resolveDesktopAutomationConfigPath();

  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export function getTargetComposerSearch(config, targetApp) {
  const configTargetApp = resolveComposerConfigTarget(targetApp);
  return cloneJson(config?.targets?.[configTargetApp]?.composerSearch || {});
}

export function getTargetClickFallback(config, targetApp) {
  const configTargetApp = resolveComposerConfigTarget(targetApp);
  return cloneJson(config?.targets?.[configTargetApp]?.clickFallback || {});
}

export function getTargetCalibrationConfig(config, targetApp) {
  return {
    composerSearch: getTargetComposerSearch(config, targetApp),
    clickFallback: getTargetClickFallback(config, targetApp)
  };
}

function applyTargetCalibrationConfig(config, targetApp, calibrationConfig) {
  const nextConfig = cloneJson(config);
  const configTargetApp = resolveComposerConfigTarget(targetApp);
  const targets = ensureObjectNode(nextConfig, "targets");
  const targetNode = ensureObjectNode(targets, configTargetApp);
  const composerSearch = normalizeComposerSearch(calibrationConfig?.composerSearch);
  const clickFallback = normalizeClickFallback(calibrationConfig?.clickFallback);

  if (Object.keys(composerSearch).length === 0 && Object.keys(clickFallback).length === 0) {
    throw new Error("invalid_calibration_config");
  }

  if (Object.keys(composerSearch).length > 0) {
    targetNode.composerSearch = composerSearch;
  }

  if (Object.keys(clickFallback).length > 0) {
    targetNode.clickFallback = clickFallback;
  }

  return nextConfig;
}

export async function saveTargetCalibrationConfig(targetApp, calibrationConfig) {
  resolveTargetAppConfig(targetApp);
  await ensureRuntimeDataLayout();
  const currentConfig = await readDesktopAutomationConfig();
  const nextConfig = applyTargetCalibrationConfig(currentConfig, targetApp, calibrationConfig);

  await writeFile(
    USER_AUTOMATION_CONFIG_PATH,
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    "utf8"
  );

  return {
    configPath: USER_AUTOMATION_CONFIG_PATH,
    targetApp,
    calibrationConfig: getTargetCalibrationConfig(nextConfig, targetApp)
  };
}

export async function analyzeTargetCalibration(targetApp, options = {}) {
  try {
    const payload = await runCalibrationAnalysis(targetApp, {
      mode: "analyze",
      topCount: options.topCount || 12,
      openIfMissing: options.openIfMissing || false,
      launchCommand: options.launchCommand || ""
    });
    const config = await readDesktopAutomationConfig();

    return {
      ...payload,
      savedCalibrationConfig: getTargetCalibrationConfig(config, targetApp)
    };
  } finally {
    await tryMinimizeTargetWindow(targetApp);
  }
}

export async function testCalibrationConfig(targetApp, calibrationConfig, options = {}) {
  resolveTargetAppConfig(targetApp);
  const currentConfig = await readDesktopAutomationConfig();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fakeclaw-calibration-"));
  const tempConfigPath = path.join(tempDir, "desktop-automation.config.json");
  const mode = options.mode || DESKTOP_AUTOMATION_MODES.FOCUS;
  const prompt = options.prompt || "";
  const normalizedConfig = {
    composerSearch: normalizeComposerSearch(calibrationConfig?.composerSearch),
    clickFallback: normalizeClickFallback(calibrationConfig?.clickFallback)
  };
  const tempConfig = applyTargetCalibrationConfig(currentConfig, targetApp, normalizedConfig);

  await writeFile(tempConfigPath, `${JSON.stringify(tempConfig, null, 2)}\n`, "utf8");

  try {
    const payload = await runAutomationAction(targetApp, {
      mode,
      prompt,
      configPath: tempConfigPath,
      launchCommand: options.launchCommand || "",
      timeoutMs: options.timeoutMs
    });

    return {
      status: payload.status || "success",
      targetApp,
      mode,
      configPath: tempConfigPath,
      calibrationConfig: normalizedConfig,
      automation: payload
    };
  } finally {
    await tryMinimizeTargetWindow(targetApp);
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function getCalibrationUiBootstrap() {
  const config = await readDesktopAutomationConfig();

  return {
    configPath: getDesktopAutomationConfigPath(),
    targets: listAutomationTargetConfigs()
      .filter((target) => CALIBRATION_TARGETS.has(target.id))
      .map((target) => ({
        id: target.id,
        displayName: target.displayName,
        calibrationConfig: getTargetCalibrationConfig(config, target.id)
      }))
  };
}
