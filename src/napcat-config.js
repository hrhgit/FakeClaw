import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_NAPCAT_HOST = "127.0.0.1";
const DEFAULT_NAPCAT_PORT = 3001;

function isLocalHost(host) {
  const normalized = String(host || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function isWildcardHost(host) {
  const normalized = String(host || "")
    .trim()
    .toLowerCase();
  return normalized === "" || normalized === "0.0.0.0" || normalized === "::";
}

function hostsMatch(serverHost, targetHost) {
  if (isWildcardHost(serverHost)) {
    return true;
  }

  const normalizedServerHost = String(serverHost || "")
    .trim()
    .toLowerCase();
  const normalizedTargetHost = String(targetHost || "")
    .trim()
    .toLowerCase();

  if (normalizedServerHost === normalizedTargetHost) {
    return true;
  }

  return isLocalHost(normalizedServerHost) && isLocalHost(normalizedTargetHost);
}

function parseNapCatWsUrl(wsUrl) {
  try {
    const target = new URL(String(wsUrl || "").trim() || `ws://${DEFAULT_NAPCAT_HOST}:${DEFAULT_NAPCAT_PORT}`);
    return {
      host: target.hostname || DEFAULT_NAPCAT_HOST,
      port: Number(target.port) || DEFAULT_NAPCAT_PORT
    };
  } catch {
    return {
      host: DEFAULT_NAPCAT_HOST,
      port: DEFAULT_NAPCAT_PORT
    };
  }
}

async function directoryExists(targetPath) {
  try {
    const entries = await readdir(targetPath);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

async function resolveNapCatConfigDirectories(startScriptPath) {
  const scriptDirectory = path.dirname(path.resolve(String(startScriptPath || "").trim()));
  const versionRoot = path.join(scriptDirectory, "versions");
  const directConfigPath = path.join(scriptDirectory, "resources", "app", "napcat", "config");
  let versionDirectories = [];

  if (await directoryExists(versionRoot)) {
    const entries = await readdir(versionRoot, { withFileTypes: true });
    versionDirectories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionRoot, entry.name))
      .sort()
      .reverse();
  }

  return [
    ...versionDirectories.map((versionDirectory) =>
      path.join(versionDirectory, "resources", "app", "napcat", "config")
    ),
    directConfigPath
  ];
}

function collectTokenCandidates(config, filePath, targetHost, targetPort) {
  const websocketServers = Array.isArray(config?.network?.websocketServers)
    ? config.network.websocketServers
    : [];

  return websocketServers
    .map((server) => {
      const token = String(server?.token || "").trim();
      if (!token) {
        return null;
      }

      const port = Number(server?.port) || DEFAULT_NAPCAT_PORT;
      const host = String(server?.host || DEFAULT_NAPCAT_HOST).trim();
      const enabled = server?.enable !== false;
      let score = 0;

      if (enabled) {
        score += 2;
      }
      if (port === targetPort) {
        score += 2;
      }
      if (hostsMatch(host, targetHost)) {
        score += 2;
      }

      return {
        token,
        score,
        configPath: filePath
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
}

export async function resolveNapCatOneBotToken({ startScriptPath = "", wsUrl = "", explicitToken = "" } = {}) {
  const fallbackToken = String(explicitToken || "").trim();
  const normalizedStartScriptPath = String(startScriptPath || "").trim();
  if (!normalizedStartScriptPath) {
    return {
      token: fallbackToken,
      source: fallbackToken ? "env" : "none",
      configPath: "",
      explicitTokenMatches: true
    };
  }

  const { host: targetHost, port: targetPort } = parseNapCatWsUrl(wsUrl);
  const configDirectories = await resolveNapCatConfigDirectories(normalizedStartScriptPath);
  for (const configDirectory of configDirectories) {
    try {
      const entries = await readdir(configDirectory, { withFileTypes: true });
      const configFiles = entries
        .filter((entry) => entry.isFile() && /^onebot11_.*\.json$/i.test(entry.name))
        .map((entry) => path.join(configDirectory, entry.name))
        .sort();

      for (const configPath of configFiles) {
        try {
          const rawConfig = await readFile(configPath, "utf8");
          const candidates = collectTokenCandidates(
            JSON.parse(rawConfig.replace(/^\uFEFF/, "")),
            configPath,
            targetHost,
            targetPort
          );
          if (candidates.length > 0) {
            return {
              token: candidates[0].token,
              source: "onebot_config",
              configPath: candidates[0].configPath,
              explicitTokenMatches: !fallbackToken || fallbackToken === candidates[0].token
            };
          }
        } catch {
        }
      }
    } catch {
    }
  }

  return {
    token: fallbackToken,
    source: fallbackToken ? "env" : "none",
    configPath: "",
    explicitTokenMatches: true
  };
}
