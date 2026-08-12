import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalServerPath = path.join(srcDirectory, "server.js");
const runtimeServerPath = path.join(srcDirectory, ".tw-store-server-2.5.runtime.mjs");

const TW_STORE_PUBLIC_URL = "https://tw-store-application.up.railway.app";
const LEGACY_PUBLIC_URL = "https://hype-equipe-production.up.railway.app";

// Mantém o backend, Checkout do Mercado Pago e webhooks apontando para a URL oficial da Tw Store.
const configuredPublicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
if (!configuredPublicBaseUrl || configuredPublicBaseUrl === LEGACY_PUBLIC_URL) {
  process.env.PUBLIC_BASE_URL = TW_STORE_PUBLIC_URL;
}

// Corrige em runtime qualquer referência antiga existente nos arquivos públicos.
// Isso evita "Failed to fetch" caso algum JS antigo ainda tenha sido enviado ao GitHub.
const publicDirectory = path.resolve(srcDirectory, "../public");
const publicExtensions = new Set([".js", ".html", ".css"]);

function normalizePublicUrls(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      normalizePublicUrls(entryPath);
      continue;
    }

    if (!entry.isFile() || !publicExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    const source = fs.readFileSync(entryPath, "utf8");
    if (!source.includes(LEGACY_PUBLIC_URL)) continue;

    const normalized = source.split(LEGACY_PUBLIC_URL).join(TW_STORE_PUBLIC_URL);
    fs.writeFileSync(entryPath, normalized, "utf8");
    console.log("Tw Store: URL antiga corrigida em arquivo público", {
      file: path.relative(publicDirectory, entryPath),
    });
  }
}

normalizePublicUrls(publicDirectory);

function injectOnce(source, anchor, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(anchor)) {
    throw new Error(`Não foi possível preparar a atualização 2.5: ponto '${label}' não encontrado em src/server.js.`);
  }
  return source.replace(anchor, replacement);
}

if (!fs.existsSync(originalServerPath)) {
  throw new Error("src/server.js não foi encontrado. Mantenha o arquivo original do repositório.");
}

let serverSource = fs.readFileSync(originalServerPath, "utf8");

serverSource = injectOnce(
  serverSource,
  'import { SmmClient } from "./smm-client.js";',
  'import { SmmClient } from "./smm-client.js";\nimport { createSupportFeatures } from "./support-features.js";\nimport { createVpnFeatures } from "./vpn-features.js";\nimport { createReportFeatures } from "./report-features.js";\nimport { createPaymentPushFeatures } from "./payment-push-features.js";',
  "imports de recursos adicionais",
);

serverSource = injectOnce(
  serverSource,
  "const legacyApp = await createApp({ config, db, smm, mercadoPago });",
  "const paymentPushFeatures = await createPaymentPushFeatures({ config, db });\nconst supportFeatures = await createSupportFeatures({ config, db });\nconst vpnFeatures = await createVpnFeatures({ config, db });\nconst reportFeatures = await createReportFeatures({ config, db });\nconst legacyApp = await createApp({ config, db, smm, mercadoPago });",
  "criação dos recursos adicionais",
);

serverSource = injectOnce(
  serverSource,
  'app.set("trust proxy", 1);\napp.use(catalogRouter);',
  'app.set("trust proxy", 1);\napp.use(paymentPushFeatures.router);\napp.use(supportFeatures.router);\napp.use(vpnFeatures.router);\napp.use(reportFeatures.router);\napp.use(catalogRouter);',
  "montagem dos routers",
);

serverSource = injectOnce(
  serverSource,
  "await Promise.allSettled([db.close(), catalogPool.end()]);",
  "await Promise.allSettled([db.close(), catalogPool.end(), paymentPushFeatures.close(), supportFeatures.close(), vpnFeatures.close(), reportFeatures.close()]);",
  "encerramento do servidor",
);

fs.writeFileSync(runtimeServerPath, serverSource, "utf8");
await import(pathToFileURL(runtimeServerPath).href + `?v=${Date.now()}`);
