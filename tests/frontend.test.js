import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildArchiveEntries,
  buildEvidenceRows,
  buildFixtureDetail,
  buildInvestigationTrace,
  buildProfileOptions,
  canRenderAlertDetail,
  fetchHealth,
  formatUtcTimestamp,
  investigationSourceLabel,
  isMobileLayout,
  reconcileAlertSelection,
} from "../public/view-model.js";
import { archiveProfiles } from "../public/archive-data.js";
import { investigationReceiptSchema } from "../src/domain/schemas.js";
import { getTargetProfile } from "../src/profiles/registry.js";

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
  it("exposes only the three configured profiles in the selector", () => {
    const options = buildProfileOptions(archiveProfiles, "etherfi-base-weeth-oft");

    expect(options.map(({ label }) => label)).toEqual([
      "Aave V3 Base Pool",
      "Compound III Base USDC Comet",
      "ether.fi Base weETH OFT",
    ]);
    expect(options.filter(({ isActive }) => isActive).map(({ id }) => id)).toEqual(["etherfi-base-weeth-oft"]);
    expect(options.every(({ id }) => !id.startsWith("0x"))).toBe(true);
  });

  it("builds one real archive entry from each committed verified fixture", () => {
    const entries = buildArchiveEntries(archiveProfiles);

    expect(entries).toHaveLength(3);
    expect(entries.map(({ profileId }) => profileId).sort()).toEqual([
      "aave-v3-base-core",
      "compound-iii-base-usdc-comet",
      "etherfi-base-weeth-oft",
    ]);
    expect(entries.every(({ event, disposition, checkCount, receiptId }) => (
      event === "Upgraded(address)"
      && disposition === "corroborated"
      && checkCount === 6
      && /^receipt_[0-9a-f]{64}$/.test(receiptId)
    ))).toBe(true);
    expect(buildArchiveEntries([])).toEqual([]);
  });

  it("keeps archive triggers and checks tied to the committed fixture and registry", () => {
    for (const profile of archiveProfiles) {
      const registered = getTargetProfile(profile.id);
      const fixtureRoot = new URL(`../${registered.expectedFixture.path}/`, import.meta.url);
      const block = JSON.parse(readFileSync(new URL("block.json", fixtureRoot), "utf8"));
      const transaction = JSON.parse(readFileSync(new URL("transaction.json", fixtureRoot), "utf8"));
      const receipt = JSON.parse(readFileSync(new URL("receipt.json", fixtureRoot), "utf8"));
      const event = JSON.parse(readFileSync(new URL("expected-events.json", fixtureRoot), "utf8"))[0];

      expect(profile.block).toMatchObject({ number: block.number, hash: block.hash, timestamp: block.timestamp });
      expect(profile.transaction.hash).toBe(transaction.hash);
      expect(profile.receipt.trigger.log).toMatchObject({
        index: receipt.selectedLogs[0].logIndex,
        emitter: event.emitter,
        topic0: receipt.selectedLogs[0].topics[0],
      });
      expect(profile.implementation.toLowerCase()).toBe(event.decodedArguments.implementation.toLowerCase());
      expect(profile.receipt.checks.map(({ id }) => id)).toEqual(registered.plans.approved.selectedChecks);
    }
  });

  it("keeps fixture and live source labels explicit", () => {
    expect(investigationSourceLabel("verified-fixture")).toBe("Verified fixture");
    expect(investigationSourceLabel("live")).toBe("Live RPC result");
  });

  it("ships valid deterministic fixture receipts and receipt links", () => {
    for (const profile of archiveProfiles) {
      expect(investigationReceiptSchema.safeParse(profile.receipt).success).toBe(true);
      const detail = buildFixtureDetail(profile);
      const receiptStage = buildInvestigationTrace(detail)[5];
      expect(receiptStage.links).toEqual([expect.objectContaining({
        href: `/api/receipts/${profile.receipt.receiptId}`,
        download: `watchtower-${profile.receipt.receiptId}.json`,
      })]);
    }
  });

  it("uses the compact mobile layout boundary without changing evidence", () => {
    expect(isMobileLayout(390)).toBe(true);
    expect(isMobileLayout(720)).toBe(true);
    expect(isMobileLayout(721)).toBe(false);
    expect(isMobileLayout(Number.NaN)).toBe(false);
  });

  it("keeps the profile, archive, empty, failure, and mobile states in the rendered assets", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

    expect(html).toContain('id="profile-selector"');
    expect(html).toContain('id="archive-body"');
    expect(html).toContain('id="archive-empty"');
    expect(html).toContain('id="failure-panel"');
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain(".archive-table td::before");
    expect(css).toContain(".investigation-shell { grid-template-columns: 1fr; }");
  });

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

  it("renders the fixed Compound identity checks as a complete protocol stage", () => {
    const compoundEvidence = structuredClone(evidence);
    const compoundIds = ["governor-before", "governor-at-upgrade", "base-token-at-upgrade"];
    compoundEvidence.upgradeInvestigation.plan.selectedChecks = [
      "implementation-before",
      "implementation-at-upgrade",
      "implementation-bytecode",
      ...compoundIds,
    ];
    compoundEvidence.upgradeInvestigation.checks = [
      ...checks.slice(0, 3),
      check("governor-before", "eth_call", "0x265f245"),
      check("governor-at-upgrade", "eth_call", "0x265f246"),
      check("base-token-at-upgrade", "eth_call", "0x265f246"),
    ];
    delete compoundEvidence.sources.addresses.provider;
    compoundEvidence.sources.addresses.governor = "https://basescan.org/address/governor";
    compoundEvidence.sources.addresses["base-token"] = "https://basescan.org/address/usdc";

    const trace = buildInvestigationTrace({ alert, evidence: compoundEvidence });

    expect(trace[4].status).toBe("complete");
    expect(trace[4].details.map(({ id }) => id)).toEqual(compoundIds);
    expect(trace[4].links.map(({ label }) => label)).toEqual(["Verify governor", "Verify Base USDC"]);
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
