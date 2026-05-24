function readNumericEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readPortOffset(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const PORTMUX_BASE_PORT = readNumericEnv(
  "PORT",
  readNumericEnv("ADMIN_CONTROL_PORT", 3213)
);

export const ADMIN_CONTROL_PORT = readNumericEnv(
  "ADMIN_CONTROL_PORT",
  PORTMUX_BASE_PORT
);

export const CALIBRATION_WEB_PORT = readNumericEnv(
  "CALIBRATION_WEB_PORT",
  ADMIN_CONTROL_PORT + readPortOffset("CALIBRATION_WEB_PORT_OFFSET", 1)
);

export const WECOM_WEBHOOK_PORT = readNumericEnv(
  "WECOM_WEBHOOK_PORT",
  ADMIN_CONTROL_PORT + readPortOffset("WECOM_WEBHOOK_PORT_OFFSET", 2)
);
