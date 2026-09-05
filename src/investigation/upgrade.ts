import type { Address, ChainReader } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import type { UpgradeInvestigation, UpgradeInvestigationCheck } from "../domain/schemas.js";
import { upgradeInvestigationSchema } from "../domain/schemas.js";
import { normalizeEvmAddress } from "../evm/address.js";
import { RegisteredCheckExecutor } from "./checks.js";
import { selectInvestigationPlan, type InvestigationPlan } from "./plans.js";

export type InvestigationOptions = {
  signal?: AbortSignal;
  now?: () => number;
  execute?: (executor: RegisteredCheckExecutor) => Promise<void>;
};

export function finalizeUpgradeInvestigation(
  plan: InvestigationPlan,
  checks: UpgradeInvestigationCheck[],
): UpgradeInvestigation {
  const requiredChecks = checks.filter(({ required }) => required);
  const disposition = plan.id === "stop-incomplete"
    ? "incomplete"
    : requiredChecks.some(({ status }) => status === "mismatch")
      ? "contradicted"
      : requiredChecks.some(({ status }) => status === "failed" || status === "unsupported")
        ? "incomplete"
        : "corroborated";
  const evidenceStatus = plan.id === "stop-incomplete" || checks.some(({ status }) => status === "failed" || status === "unsupported")
    ? "incomplete"
    : "complete";
  return upgradeInvestigationSchema.parse({ plan, disposition, evidenceStatus, checks });
}

export async function investigateApprovedUpgrade(
  reader: ChainReader,
  config: TargetConfig,
  decodedImplementation: Address,
  selectedPlan: InvestigationPlan = selectInvestigationPlan({
    targetId: config.target.id,
    eventSignature: config.detectors[0].eventSignature,
    triggerEvidenceStatus: "complete",
    severityRuleId: "target-is-approved",
  }),
  options: InvestigationOptions = {},
): Promise<UpgradeInvestigation> {
  const executor = new RegisteredCheckExecutor(
    reader,
    config,
    normalizeEvmAddress(decodedImplementation),
    selectedPlan,
    options,
  );
  if (options.execute) await options.execute(executor);
  await executor.runRemainingRequired();
  return finalizeUpgradeInvestigation(executor.plan, executor.completedChecks());
}
