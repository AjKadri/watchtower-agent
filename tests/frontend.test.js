import { describe, expect, it, vi } from "vitest";

import {
  buildEvidenceRows,
  buildInvestigationTrace,
  canRenderAlertDetail,
  fetchHealth,
  formatUtcTimestamp,
  reconcileAlertSelection,
} from "../public/view-model.js";

const plan = {
  id: "corroborate-approved-upgrade",
  version: "1.0.0",
  selectionReason: { code: "approved-target", text: "Approved target selected by the deterministic rule." },
  selectedChecks: [
    "implementation-before",
    "implementation-at-upgrade",
    "implementation-bytecode",
    "configured-pool",
    "pool-revision-before",
    "pool-revision-at-upgrade",
  ],
  skippedChecks: [],
  capabilityBudget: { maximumReads: 6, capabilities: [] },
};

function check(id, method, blockTag) {
  return {
    id,
    required: !id.startsWith("pool-revision"),
    method,
    parameters: {},
    blockTag,
    result: { kind: "uint256", value: "1" },
    assertion: { expected: "1", actual: "1", matches: true },
    status: "passed",
    failure: null,
  };
}

const checks = [
  check("implementation-before", "eth_getStorageAt", "0x27339e1"),
  check("implementation-at-upgrade", "eth_getStorageAt", "0x27339e2"),
  check("implementation-bytecode", "eth_getCode", "0x27339e2"),
  check("configured-pool", "eth_call", "0x27339e2"),
  check("pool-revision-before", "eth_call", "0x27339e1"),
  check("pool-revision-at-upgrade", "eth_call", "0x27339e2"),
];

const evidence = {
  status: "complete",
  network: { name: "base-mainnet", chainId: 8453 },
  block: { number: "41105890", hash: `0x${"a".repeat(64)}`, timestamp: "2026-01-21T13:12:07.000Z" },
  transaction: {
    hash: `0x${"b".repeat(64)}`,
    sender: `0x${"c".repeat(40)}`,
    recipient: `0x${"d".repeat(40)}`,
    receiptStatus: "success",
  },
  log: {
    index: "641",
    emitter: `0x${"e".repeat(40)}`,
    topic0: `0x${"f".repeat(64)}`,
    rawTopics: [`0x${"f".repeat(64)}`, `0x${"1".repeat(64)}`],
  },
  event: { signature: "Upgraded(address)", decodedArguments: { implementation: `0x${"2".repeat(40)}` } },
  relevantAddresses: [
    { role: "pool-proxy", address: `0x${"e".repeat(40)}` },
    { role: "decoded-implementation", address: `0x${"2".repeat(40)}` },
  ],
  detector: { inputs: { configuredEmitter: `0x${"e".repeat(40)}`, configuredTopic0: `0x${"f".repeat(64)}` } },
  severity: { ruleId: "target-is-approved", inputs: { approved: "true", isZeroAddress: "false" } },
  sources: {
    transaction: "https://basescan.org/tx/example",
    block: "https://basescan.org/block/41105890",
    addresses: {
      sender: "https://basescan.org/address/sender",
      recipient: "https://basescan.org/address/recipient",
      emitter: "https://basescan.org/address/emitter",
      implementation: "https://basescan.org/address/implementation",
      provider: "https://basescan.org/address/provider",
    },
  },
  upgradeInvestigation: { plan, disposition: "corroborated", evidenceStatus: "complete", checks },
  investigationReceipt: {
    receiptId: `receipt_${"3".repeat(64)}`,
    finalDisposition: "corroborated",
    errors: [],
  },
};

const alert = { id: "alert-current", classificationLabel: "Contract upgrade" };

describe("dashboard view model", () => {
  it("loads the frontend health indicator from /api/health", async () => {
    const request = vi.fn().mockResolvedValue({ status: "ok" });

    await expect(fetchHealth(request)).resolves.toEqual({ status: "ok" });
    expect(request).toHaveBeenCalledWith("/api/health");
  });

  it("formats timestamps with an explicit UTC label", () => {
    expect(formatUtcTimestamp("2026-01-21T13:12:07.000Z")).toBe("2026-01-21T13:12:07.000Z (UTC)");
    expect(formatUtcTimestamp(null)).toBe("Time unavailable");
  });

  it("exposes the reviewed evidence fields and one consistent classification label", () => {
    const rows = buildEvidenceRows(evidence, "Contract upgrade");
    const byLabel = Object.fromEntries(rows.map(({ label, value }) => [label, value]));

    expect(byLabel).toMatchObject({
      Classification: "Contract upgrade",
      Sender: evidence.transaction.sender,
      Recipient: evidence.transaction.recipient,
      "Topic zero": evidence.log.topic0,
      "Raw topics": evidence.log.rawTopics.join("\n"),
      "Detector inputs": expect.stringContaining("configuredEmitter"),
      "Severity inputs": expect.stringContaining("approved: true"),
      "Configured address roles": expect.stringContaining("pool-proxy"),
    });
  });

  it("clears a stale selection when alerts disappear or are replaced", () => {
    expect(reconcileAlertSelection([], "old-alert", true)).toBeNull();
    expect(reconcileAlertSelection([{ id: "new-alert" }], "old-alert", false)).toBeNull();
    expect(reconcileAlertSelection([{ id: "new-alert" }], "old-alert", true)).toBe("new-alert");
    expect(reconcileAlertSelection([{ id: "current-alert" }], "current-alert", false)).toBe("current-alert");
    expect(canRenderAlertDetail([{ id: "new-alert" }], "new-alert", "old-alert")).toBe(false);
    expect(canRenderAlertDetail([{ id: "current-alert" }], "current-alert", "current-alert")).toBe(true);
  });

  it("builds the visible six-stage trace and receipt download", () => {
    const trace = buildInvestigationTrace({ alert, evidence });

    expect(trace).toHaveLength(6);
    expect(trace.map(({ title, status }) => ({ title, status }))).toEqual([
      { title: "Event observed", status: "complete" },
      { title: "Plan selected", status: "complete" },
      { title: "Historical state checked", status: "complete" },
      { title: "Implementation checked", status: "complete" },
      { title: "Protocol identity checked", status: "complete" },
      { title: "Receipt issued", status: "complete" },
    ]);
    expect(trace[5].links).toEqual([expect.objectContaining({
      label: "Download receipt JSON",
      href: `/api/receipts/${evidence.investigationReceipt.receiptId}`,
      download: `watchtower-${evidence.investigationReceipt.receiptId}.json`,
    })]);
  });

  it("keeps incomplete investigation and skipped checks visible", () => {
    const incompleteEvidence = structuredClone(evidence);
    incompleteEvidence.block.timestamp = null;
    incompleteEvidence.transaction.sender = null;
    incompleteEvidence.investigationReceipt = null;
    incompleteEvidence.upgradeInvestigation = {
      plan: {
        ...plan,
        id: "stop-incomplete",
        selectedChecks: [],
        skippedChecks: [...plan.selectedChecks],
        capabilityBudget: { maximumReads: 0, capabilities: [] },
      },
      disposition: "incomplete",
      evidenceStatus: "incomplete",
      checks: [],
    };

    const trace = buildInvestigationTrace({ alert, evidence: incompleteEvidence });

    expect(trace[0].status).toBe("incomplete");
    expect(trace[2].status).toBe("incomplete");
    expect(trace[2].details).toEqual(expect.arrayContaining([expect.objectContaining({ status: "skipped" })]));
    expect(trace[5]).toMatchObject({ status: "incomplete", links: [] });
  });

  it("keeps failed assertions visible in the trace", () => {
    const failedEvidence = structuredClone(evidence);
    failedEvidence.upgradeInvestigation.checks[1].status = "mismatch";
    failedEvidence.upgradeInvestigation.checks[1].assertion.matches = false;
    failedEvidence.upgradeInvestigation.disposition = "contradicted";
    failedEvidence.investigationReceipt.finalDisposition = "contradicted";

    const trace = buildInvestigationTrace({ alert, evidence: failedEvidence });

    expect(trace[2].status).toBe("failed");
    expect(trace[2].details).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "implementation-at-upgrade", status: "mismatch" }),
    ]));
    expect(trace[5].status).toBe("failed");
  });
});
