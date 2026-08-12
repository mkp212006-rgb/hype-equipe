import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalServerPath = path.join(srcDirectory, "server.js");
const runtimeServerPath = path.join(srcDirectory, ".tw-store-server-2.5.runtime.mjs");

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
  'import { SmmClient } from "./smm-client.js";\nimport { createSupportFeatures } from "./support-features.js";\nimport { createVpnFeatures } from "./vpn-features.js";\nimport { createReportFeatures } from "./report-features.js";',
  "imports de recursos adicionais",
);

serverSource = injectOnce(
  serverSource,
  "const legacyApp = await createApp({ config, db, smm, mercadoPago });",
  "const supportFeatures = await createSupportFeatures({ config, db });\nconst vpnFeatures = await createVpnFeatures({ config, db });\nconst reportFeatures = await createReportFeatures({ config, db });\nconst legacyApp = await createApp({ config, db, smm, mercadoPago });",
  "criação dos recursos adicionais",
);

serverSource = injectOnce(
  serverSource,
  'app.set("trust proxy", 1);\napp.use(catalogRouter);',
  'app.set("trust proxy", 1);\napp.use(supportFeatures.router);\napp.use(vpnFeatures.router);\napp.use(reportFeatures.router);\napp.use(catalogRouter);',
  "montagem dos routers",
);

serverSource = injectOnce(
  serverSource,
  "await Promise.allSettled([db.close(), catalogPool.end()]);",
  "await Promise.allSettled([db.close(), catalogPool.end(), supportFeatures.close(), vpnFeatures.close(), reportFeatures.close()]);",
  "encerramento do servidor",
);

fs.writeFileSync(runtimeServerPath, serverSource, "utf8");
await import(pathToFileURL(runtimeServerPath).href + `?v=${Date.now()}`);
