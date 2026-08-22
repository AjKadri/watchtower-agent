import { createViemChainReader } from "../chain/viem-reader.js";
import { loadRuntimeConfig } from "../config/load.js";
import { createApp } from "./app.js";

async function main(): Promise<void> {
  const runtime = await loadRuntimeConfig();
  const app = createApp({
    reader: createViemChainReader(runtime.rpcUrl),
    config: runtime.target,
  });
  const server = app.listen(runtime.port, "127.0.0.1", () => {
    process.stdout.write(`Watchtower listening at http://localhost:${runtime.port}\n`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  process.stderr.write("Watchtower server could not start. Check the documented environment configuration.\n");
  process.exitCode = 1;
});
