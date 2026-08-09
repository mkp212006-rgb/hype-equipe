import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function boolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeUrl(value, fallback) {
  const raw = String(value || fallback || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("SMM_API_URL precisa usar HTTP ou HTTPS.");
  return url.toString().replace(/\/+$/, "");
}

export function loadConfig(env = process.env) {
  const config = {
    nodeEnv: env.NODE_ENV || "development",
    port: integer(env.PORT, 3000, 1, 65_535),
    databaseUrl: String(env.DATABASE_URL || "").trim(),
    databaseSsl: boolean(env.DATABASE_SSL, false),
    jwtSecret: String(env.JWT_SECRET || ""),
    tokenTtlSeconds: integer(env.TOKEN_TTL_SECONDS, 43_200, 900, 604_800),
    adminUsername: String(env.ADMIN_USERNAME || "admin").trim(),
    adminPassword: String(env.ADMIN_PASSWORD || ""),
    initialTeamCode: String(env.INITIAL_TEAM_CODE || ""),
    smmApiUrl: normalizeUrl(env.SMM_API_URL, "https://smmhype.com/api/v2"),
    smmApiKey: String(env.SMM_API_KEY || "").trim(),
    smmTimeoutMs: integer(env.SMM_TIMEOUT_MS, 20_000, 2_000, 60_000),
    allowedOrigins: String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((item) => item.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    publicDirectory: path.resolve(currentDirectory, "../public"),
  };

  const problems = [];
  if (!config.databaseUrl) problems.push("DATABASE_URL não foi definida");
  if (config.jwtSecret.length < 32) problems.push("JWT_SECRET deve ter pelo menos 32 caracteres");
  if (!config.adminUsername) problems.push("ADMIN_USERNAME não pode ficar vazio");
  if (config.adminPassword.length < 12) problems.push("ADMIN_PASSWORD deve ter pelo menos 12 caracteres");
  if (config.initialTeamCode && config.initialTeamCode.length < 6) {
    problems.push("INITIAL_TEAM_CODE deve ter pelo menos 6 caracteres ou ficar vazio");
  }
  if (problems.length) throw new Error(`Configuração inválida: ${problems.join("; ")}.`);
  return config;
}
