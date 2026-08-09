import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_PARAMS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function hmac(value, secret) {
  return createHmac("sha256", secret).update(value).digest();
}

export function signToken(payload, secret, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(options.ttlSeconds || 43_200);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson({
    ...payload,
    iss: options.issuer || "hype-equipe",
    aud: options.audience || "hype-equipe-app",
    iat: now,
    exp: now + ttlSeconds,
  });
  const unsigned = `${header}.${body}`;
  const signature = hmac(unsigned, secret).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function verifyToken(token, secret, options = {}) {
  if (typeof token !== "string") throw new Error("Token ausente.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token inválido.");

  const unsigned = `${parts[0]}.${parts[1]}`;
  const received = Buffer.from(parts[2], "base64url");
  const expected = hmac(unsigned, secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Token inválido.");
  }

  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    throw new Error("Token inválido.");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("Token inválido.");

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error("Sessão expirada.");
  if (payload.nbf && payload.nbf > now) throw new Error("Token ainda não é válido.");
  if (payload.iss !== (options.issuer || "hype-equipe")) throw new Error("Token inválido.");
  if (payload.aud !== (options.audience || "hype-equipe-app")) throw new Error("Token inválido.");
  return payload;
}

export async function hashSecret(secret) {
  if (typeof secret !== "string" || secret.length < 6) {
    throw new Error("O segredo precisa ter pelo menos 6 caracteres.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(secret, salt, 64, SCRYPT_PARAMS);
  return [
    "scrypt-v1",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function verifySecret(secret, encoded) {
  try {
    const [version, n, r, p, saltValue, hashValue] = String(encoded).split("$");
    if (version !== "scrypt-v1") return false;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(String(secret), Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
