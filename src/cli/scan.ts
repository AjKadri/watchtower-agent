import { createViemChainReader } from "../chain/viem-reader.js";
import { loadRuntimeConfig } from "../config/load.js";
import { scanApprovedRange } from "../pipeline/scanner.js";
import { classifyCliFailure, type CliFailurePhase } from "./failures.js";

function reportFailure(error: unknown, phase: CliFailurePhase): void {
  const failure = classifyCliFailure(error, phase);
  process.stderr.write(`${JSON.stringify({ status: "failed", error: failure })}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let runtime: Awaited<ReturnType<typeof loadRuntimeConfig>>;
  try {
    runtime = await loadRuntimeConfig();
  } catch (error) {
    reportFailure(error, "configuration");
    return;
  }

  try {
    const reader = createViemChainReader(runtime.rpcUrl);
    const result = await scanApprovedRange(reader, runtime.target);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    reportFailure(error, "runtime");
  }
}

void main();
