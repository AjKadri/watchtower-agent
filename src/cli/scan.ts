import { ZodError } from "zod";

import { createViemChainReader } from "../chain/viem-reader.js";
import { loadRuntimeConfig } from "../config/load.js";
import { scanApprovedRange } from "../pipeline/scanner.js";

async function main(): Promise<void> {
  const runtime = await loadRuntimeConfig();
  const reader = createViemChainReader(runtime.rpcUrl);
  const result = await scanApprovedRange(reader, runtime.target);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof ZodError
    ? "Watchtower configuration is invalid."
    : error instanceof SyntaxError
      ? "Watchtower target configuration is not valid JSON."
      : error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "Watchtower target configuration could not be read."
        : "Watchtower scan could not start.";
  process.stderr.write(`${JSON.stringify({ status: "failed", error: { code: "startup-failed", message } })}\n`);
  process.exitCode = 1;
});
