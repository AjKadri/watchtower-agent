import type { TargetConfig } from "../config/schema.js";
import type { Address } from "../chain/types.js";

export type SeverityDecision = {
  severity: "high" | "suspicious" | "informational";
  ruleId: "target-is-zero-address" | "target-is-not-approved" | "target-is-approved";
  inputs: Record<string, string>;
};

const zeroAddress = "0x0000000000000000000000000000000000000000";

export function classifyUpgrade(implementation: Address, policy: TargetConfig["severityPolicy"]): SeverityDecision {
  const normalized = implementation.toLowerCase();
  const approved = policy.approvedTargetAddresses.some((address) => address.toLowerCase() === normalized);
  const inputs = { implementation, approved: String(approved), isZeroAddress: String(normalized === zeroAddress) };

  if (normalized === zeroAddress) {
    return { severity: "high", ruleId: "target-is-zero-address", inputs };
  }
  if (!approved) {
    return { severity: "suspicious", ruleId: "target-is-not-approved", inputs };
  }
  return { severity: "informational", ruleId: "target-is-approved", inputs };
}
