import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalServerPath = path.join(srcDirectory, "server.js");
const runtimeServerPath = path.join(srcDirectory, ".tw-store-server-2.2.runtime.mjs");

function injectOnce(source, anchor, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(anchor)) {
    throw new Error(`Não foi possível preparar a atualização 2.2: ponto '${label}' não encontrado em src/server.js.`);
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
  'import { SmmClient } from "./smm-client.js";\nimport { createSupportFeatures } from "./support-features.js";',
  "import do SmmClient",
);

serverSource = injectOnce(
  serverSource,
  "const legacyApp = await createApp({ config, db, smm, mercadoPago });",
  "const supportFeatures = await createSupportFeatures({ config, db });\nconst legacyApp = await createApp({ config, db, smm, mercadoPago });",
  "criação do legacyApp",
);

serverSource = injectOnce(
  serverSource,
  'app.set("trust proxy", 1);\napp.use(catalogRouter);',
  'app.set("trust proxy", 1);\napp.use(supportFeatures.router);\napp.use(catalogRouter);',
  "montagem do catalogRouter",
);

serverSource = injectOnce(
  serverSource,
  "await Promise.allSettled([db.close(), catalogPool.end()]);",
  "await Promise.allSettled([db.close(), catalogPool.end(), supportFeatures.close()]);",
  "encerramento do servidor",
);

fs.writeFileSync(runtimeServerPath, serverSource, "utf8");
await import(pathToFileURL(runtimeServerPath).href + `?v=${Date.now()}`);
