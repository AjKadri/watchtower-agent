import type {
  InvestigationReceipt,
  InvestigationReceiptTrigger,
  UpgradeInvestigation,
} from "../domain/schemas.js";
import { investigationReceiptSchema, investigationReceiptTriggerSchema } from "../domain/schemas.js";
import { createReceiptId } from "../pipeline/ids.js";

type ExplorerLinks = InvestigationReceipt["explorerLinks"];

export function createInvestigationReceipt(
  triggerInput: InvestigationReceiptTrigger,
  investigation: UpgradeInvestigation,
  explorerLinks: ExplorerLinks,
): InvestigationReceipt {
  const trigger = investigationReceiptTriggerSchema.parse(triggerInput);
  const errors = investigation.checks.flatMap((check) => check.failure ? [check.failure] : []);
  const limitations = [
    "This receipt records deterministic read-only checks for one configured historical upgrade and does not establish identity, intent, causality, or implementation safety.",
  ];
  if (investigation.plan.skippedChecks.length > 0) {
    limitations.push("Checks listed as skipped were not executed and have no RPC result in this receipt.");
  }
  if (investigation.evidenceStatus === "incomplete") {
    limitations.push("One or more selected checks could not be verified. Review each recorded error before relying on the result.");
  }

  const payload = {
    schemaVersion: 1 as const,
    trigger,
    plan: investigation.plan,
    checks: investigation.checks,
    errors,
    limitations,
    finalDisposition: investigation.disposition,
    explorerLinks,
  };

  return investigationReceiptSchema.parse({
    receiptId: createReceiptId(payload),
    ...payload,
  });
}
