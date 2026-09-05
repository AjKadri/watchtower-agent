import { agentToolRequestSchema } from "./schemas.js";
import type { RegisteredCheckExecutor } from "../investigation/checks.js";

export async function executeAgentTool(executor: RegisteredCheckExecutor, request: unknown) {
  const parsed = agentToolRequestSchema.parse(request);
  if (!executor.remainingCheckIds().includes(parsed.checkId)) {
    throw new Error("The agent requested a check that is unavailable, outside the selected plan, or already executed.");
  }
  return executor.run(parsed.checkId);
}
