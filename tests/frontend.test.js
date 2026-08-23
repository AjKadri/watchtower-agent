import { describe, expect, it, vi } from "vitest";

import { buildEvidenceRows, fetchHealth, formatUtcTimestamp, reconcileAlertSelection } from "../public/view-model.js";

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
    },
  },
};

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
  });
});
