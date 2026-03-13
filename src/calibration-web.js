import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  analyzeTargetCalibration,
  getCalibrationUiBootstrap,
  saveTargetCalibrationConfig,
  testCalibrationConfig
} from "./calibration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_ROOT = path.resolve(__dirname, "../public/calibration");
const DEFAULT_HOST = process.env.CALIBRATION_WEB_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.CALIBRATION_WEB_PORT || 3210);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("payload_too_large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json_body");
  }
}

function mapFailureStatus(error) {
  const reason = error?.payload?.failureReason || error?.message || "request_failed";

  switch (reason) {
    case "app_not_found":
      return 404;
    case "window_activation_failed":
    case "focus_input_failed":
    case "focus_input_ambiguous":
    case "automation_busy":
    case "calibration_busy":
      return 409;
    case "invalid_composer_search":
    case "invalid_calibration_config":
    case "invalid_json_body":
    case "prompt_required":
      return 400;
    default:
      return 500;
  }
}

function resolveStaticPath(urlPathname) {
  const relativePath = urlPathname === "/calibration/" ? "/index.html" : urlPathname.replace(/^\/calibration/, "");
  const filePath = path.resolve(STATIC_ROOT, `.${relativePath}`);

  if (!filePath.startsWith(STATIC_ROOT)) {
    return null;
  }

  return filePath;
}

export function startCalibrationWebServer({ isAutomationBusy = () => false } = {}) {
  let activeJob = null;

  async function runExclusive(jobLabel, taskFn) {
    if (isAutomationBusy()) {
      const error = new Error("automation_busy");
      error.payload = {
        status: "failed",
        failureReason: "automation_busy"
      };
      throw error;
    }

    if (activeJob) {
      const error = new Error("calibration_busy");
      error.payload = {
        status: "failed",
        failureReason: "calibration_busy",
        activeJob
      };
      throw error;
    }

    activeJob = jobLabel;

    try {
      return await taskFn();
    } finally {
      activeJob = null;
    }
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/") {
        response.writeHead(302, { Location: "/calibration/" });
        response.end();
        return;
      }

      if (request.method === "GET" && pathname === "/calibration") {
        response.writeHead(302, { Location: "/calibration/" });
        response.end();
        return;
      }

      if (request.method === "GET" && pathname === "/api/calibration/bootstrap") {
        sendJson(response, 200, await getCalibrationUiBootstrap());
        return;
      }

      if (request.method === "POST" && pathname === "/api/calibration/analyze") {
        const body = await readJsonBody(request);
        const payload = await runExclusive("analyze", () =>
          analyzeTargetCalibration(body.targetApp, {
            openIfMissing: Boolean(body.openIfMissing),
            topCount: Number(body.topCount) || 12
          })
        );
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "POST" && pathname === "/api/calibration/test") {
        const body = await readJsonBody(request);
        const payload = await runExclusive("test", () =>
          testCalibrationConfig(body.targetApp, body.calibrationConfig || {}, {
            mode: body.mode,
            prompt: body.prompt
          })
        );
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "POST" && pathname === "/api/calibration/save") {
        const body = await readJsonBody(request);
        const payload = await saveTargetCalibrationConfig(
          body.targetApp,
          body.calibrationConfig || {}
        );
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/calibration")) {
        const filePath = resolveStaticPath(pathname);
        if (!filePath) {
          sendText(response, 404, "not_found");
          return;
        }

        const content = await readFile(filePath);
        response.writeHead(200, {
          "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
          "Cache-Control": "no-store"
        });
        response.end(content);
        return;
      }

      sendText(response, 404, "not_found");
    } catch (error) {
      sendJson(response, mapFailureStatus(error), {
        status: "failed",
        failureReason: error?.payload?.failureReason || error.message || "request_failed",
        payload: error?.payload || null
      });
    }
  });

  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    console.log(`[calibration-web] listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}/calibration/`);
  });

  return server;
}
