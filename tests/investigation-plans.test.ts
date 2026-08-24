import { describe, expect, it } from "vitest";

import { investigationPlanSchema, selectInvestigationPlan } from "../src/investigation/plans.js";

const approvedInput = {
  targetId: "aave-v3-base-core",
  eventSignature: "Upgraded(address)",
  triggerEvidenceStatus: "complete",
  severityRuleId: "target-is-approved",
} as const;

describe("deterministic investigation planner", () => {
  it("selects exactly one versioned plan from fixed trigger state", () => {
    const corroborate = selectInvestigationPlan(approvedInput);
    const escalate = selectInvestigationPlan({ ...approvedInput, severityRuleId: "target-is-not-approved" });
    const stop = selectInvestigationPlan({ ...approvedInput, triggerEvidenceStatus: "incomplete" });

    expect(corroborate).toMatchObject({ id: "corroborate-approved-upgrade", version: "1.0.0" });
    expect(escalate).toMatchObject({ id: "escalate-unapproved-upgrade", version: "1.0.0" });
    expect(stop).toMatchObject({ id: "stop-incomplete", version: "1.0.0", capabilityBudget: { maximumReads: 0 } });
  });

  it("skips optional revision reads in the unapproved-upgrade plan", () => {
    const plan = selectInvestigationPlan({ ...approvedInput, severityRuleId: "target-is-not-approved" });

    expect(plan.selectedChecks).toEqual([
      "implementation-before",
      "implementation-at-upgrade",
      "implementation-bytecode",
      "configured-pool",
    ]);
    expect(plan.skippedChecks).toEqual(["pool-revision-before", "pool-revision-at-upgrade"]);
    expect(plan.capabilityBudget).toEqual({
      maximumReads: 4,
      capabilities: [
        { name: "historical-storage-read", maximumUses: 2 },
        { name: "historical-code-read", maximumUses: 1 },
        { name: "historical-contract-call", maximumUses: 1 },
      ],
    });
  });

  it.each([
    ["compound-iii-base-usdc-comet", ["governor-before", "governor-at-upgrade", "base-token-at-upgrade"]],
    ["etherfi-base-weeth-oft", ["endpoint-at-upgrade", "token-at-upgrade", "shared-decimals-at-upgrade"]],
  ] as const)("selects only the registered target-specific checks for %s", (targetId, targetChecks) => {
    const plan = selectInvestigationPlan({ ...approvedInput, targetId });

    expect(plan.selectedChecks.slice(3)).toEqual(targetChecks);
    expect(plan.selectedChecks).not.toContain("configured-pool");
    expect(plan.capabilityBudget.maximumReads).toBe(6);
  });

  it.each([
    { capability: "arbitrary-shell" },
    { address: "0x1111111111111111111111111111111111111111" },
    { eventSignature: "Transfer(address,address,uint256)" },
    { fromBlock: "1", toBlock: "latest" },
    { rpcUrl: "https://example.invalid" },
    { call: { to: "0x1111111111111111111111111111111111111111", data: "0x1234" } },
  ])("rejects request-controlled planner scope: $capability$address$eventSignature$rpcUrl", (extra) => {
    expect(() => selectInvestigationPlan({ ...approvedInput, ...extra })).toThrow();
  });

  it("rejects a forged plan capability", () => {
    const valid = selectInvestigationPlan(approvedInput);
    const forged = structuredClone(valid) as unknown as Record<string, unknown>;
    forged.capabilityBudget = {
      maximumReads: 7,
      capabilities: [{ name: "arbitrary-call", maximumUses: 7 }],
    };

    expect(investigationPlanSchema.safeParse(forged).success).toBe(false);
  });

  it("rejects a plan containing a check ID from another profile", () => {
    const valid = selectInvestigationPlan(approvedInput);
    const forged = structuredClone(valid);
    forged.selectedChecks[3] = "governor-before";

    expect(investigationPlanSchema.safeParse(forged).success).toBe(false);
  });
});
