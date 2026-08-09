import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { SmmClient } from "./smm-client.js";

const config = loadConfig();
const db = createDatabase(config);
await db.migrate();

const smm = new SmmClient({
  apiUrl: config.smmApiUrl,
  apiKey: config.smmApiKey,
  timeoutMs: config.smmTimeoutMs,
});
const app = await createApp({ config, db, smm });
const server = http.createServer(app);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Hype Equipe ouvindo na porta ${config.port}.`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Encerrando com ${signal}.`);
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    clearTimeout(force);
    await db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
