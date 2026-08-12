import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalServerPath = path.join(srcDirectory, "server.js");
const runtimeServerPath = path.join(srcDirectory, ".tw-store-server-2.5.runtime.mjs");

const TW_STORE_PUBLIC_URL = "https://tw-store-application.up.railway.app";
const LEGACY_PUBLIC_URL = "https://hype-equipe-production.up.railway.app";

// Garante que o backend e o Checkout do Mercado Pago usem a URL oficial nova.
if (!process.env.PUBLIC_BASE_URL) process.env.PUBLIC_BASE_URL = TW_STORE_PUBLIC_URL;

// Compatibilidade: corrige em runtime referências antigas no frontend sem alterar a lógica da aplicação.
const publicAppPath = path.resolve(srcDirectory, "../public/app.js");
if (fs.existsSync(publicAppPath)) {
  const publicAppSource = fs.readFileSync(publicAppPath, "utf8");
  const normalizedPublicAppSource = publicAppSource.split(LEGACY_PUBLIC_URL).join(TW_STORE_PUBLIC_URL);
  if (normalizedPublicAppSource !== publicAppSource) {
    fs.writeFileSync(publicAppPath, normalizedPublicAppSource, "utf8");
  }
}

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
