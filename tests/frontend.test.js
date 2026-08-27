import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildArchiveEntries,
  buildEvidenceRows,
  buildFixtureDetail,
  buildInvestigationTrace,
  buildProfileOptions,
  canRenderAlertDetail,
  countInvestigationChecks,
  fetchHealth,
  formatUtcTimestamp,
  investigationStateLabel,
  isStructuredScanResult,
  isMobileLayout,
  reconcileAlertSelection,
  summarizeTraceProgression,
} from "../public/view-model.js";
import { archiveProfiles } from "../public/archive-data.js";
import { createReceiptId, normalizeEvmAddress, verifyReceipt } from "../public/receipt-verifier.js";
import { investigationReceiptSchema } from "../src/domain/schemas.js";
import { getTargetProfile } from "../src/profiles/registry.js";

describe("structured scan response handling", () => {
  it("recognizes a failed scan body returned with a non-2xx status", () => {
    expect(isStructuredScanResult({
      scanId: `scan_${"0".repeat(64)}`,
      status: "failed",
      alerts: [],
      evidence: [],
      failures: [{ code: "chain-id-rpc-timeout" }],
    })).toBe(true);
    expect(isStructuredScanResult({ error: { code: "invalid-json" } })).toBe(false);
  });
});

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
    elapsedMs: 5,
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
    expect(options.map(({ targetPurpose }) => targetPurpose)).toEqual([
      "Base Pool implementation proxy",
      "Base USDC Comet implementation proxy",
      "Base weETH OFT implementation proxy",
    ]);
    expect(options.map(({ availability }) => availability)).toEqual([
      "Verified fixture replay",
      "Verified fixture replay",
      "Live scan eligible",
    ]);
  });

  it("builds one real archive entry from each committed verified fixture", () => {
    const entries = buildArchiveEntries(archiveProfiles);

    expect(entries).toHaveLength(3);
    expect(entries.map(({ profileId }) => profileId).sort()).toEqual([
      "aave-v3-base-core",
      "compound-iii-base-usdc-comet",
      "etherfi-base-weeth-oft",
    ]);
    expect(entries.every(({ event, disposition, checkCounts, receiptId, blockLink, sourceLabel }) => (
      event === "Upgraded(address)"
      && disposition === "corroborated"
      && checkCounts.passed === 6
      && checkCounts.failed === 0
      && checkCounts.incomplete === 0
      && checkCounts.skipped === 0
      && checkCounts.total === 6
      && /^receipt_[0-9a-f]{64}$/.test(receiptId)
      && blockLink.startsWith("https://basescan.org/block/")
      && sourceLabel === "Verified fixture replay"
    ))).toBe(true);
    expect(buildArchiveEntries([])).toEqual([]);
  });

  it("derives archive check outcomes from recorded and skipped checks", () => {
    const receipt = {
      checks: [
        { id: "one", status: "passed" },
        { id: "two", status: "mismatch" },
        { id: "three", status: "unsupported" },
      ],
      plan: { skippedChecks: ["four"] },
    };

    expect(countInvestigationChecks(receipt)).toEqual({ passed: 1, failed: 1, incomplete: 1, skipped: 1, total: 4 });
  });

  it("renders archive block, complete receipt, copy, and fixture replay actions", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

    expect(app).toContain("archive-block-link");
    expect(app).toContain("archive-receipt-id");
    expect(app).toContain('"Copy receipt ID"');
    expect(app).toContain('"Replay fixture"');
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

  it("cross-checks every duplicated frontend evidence value against fixtures and registry policy", () => {
    const fixtureFields = {
      "aave-v3-base-core": {
        "implementation-before": "implementationBeforeWord",
        "implementation-at-upgrade": "implementationAtUpgradeWord",
        "implementation-bytecode": "implementationByteLength",
        "configured-pool": "getPoolResult",
        "pool-revision-before": "poolRevisionBeforeResult",
        "pool-revision-at-upgrade": "poolRevisionAtUpgradeResult",
      },
      "compound-iii-base-usdc-comet": {
        "implementation-before": "implementationBeforeWord",
        "implementation-at-upgrade": "implementationAtUpgradeWord",
        "implementation-bytecode": "implementationByteLength",
        "governor-before": "governorBeforeResult",
        "governor-at-upgrade": "governorAtUpgradeResult",
        "base-token-at-upgrade": "baseTokenAtUpgradeResult",
      },
      "etherfi-base-weeth-oft": {
        "implementation-before": "implementationBeforeWord",
        "implementation-at-upgrade": "implementationAtUpgradeWord",
        "implementation-bytecode": "implementationByteLength",
        "endpoint-at-upgrade": "endpointAtUpgradeResult",
        "token-at-upgrade": "tokenAtUpgradeResult",
        "shared-decimals-at-upgrade": "sharedDecimalsAtUpgradeResult",
      },
    };
    const addressFromWord = (word) => `0x${word.slice(-40)}`.toLowerCase();
    const blockTag = (block) => `0x${BigInt(block).toString(16)}`;

    for (const profile of archiveProfiles) {
      const registered = getTargetProfile(profile.id);
      const fixtureRoot = new URL(`../${registered.expectedFixture.path}/`, import.meta.url);
      const transaction = JSON.parse(readFileSync(new URL("transaction.json", fixtureRoot), "utf8"));
      const receipt = JSON.parse(readFileSync(new URL("receipt.json", fixtureRoot), "utf8"));
      const event = JSON.parse(readFileSync(new URL("expected-events.json", fixtureRoot), "utf8"))[0];
      const investigation = JSON.parse(readFileSync(new URL("investigation.json", fixtureRoot), "utf8"));
      const fixtureReadme = readFileSync(new URL("README.md", fixtureRoot), "utf8");
      const normalizedReadme = fixtureReadme.replace(/\s+/g, " ");
      const trigger = profile.receipt.trigger;

      expect(trigger.transaction.sender.toLowerCase()).toBe(transaction.from.toLowerCase());
      expect(trigger.transaction.recipient.toLowerCase()).toBe(transaction.to.toLowerCase());
      expect(trigger.log.rawTopics).toEqual(receipt.selectedLogs[0].topics);
      expect(trigger.log.rawTopics[1]).toBe(`0x${"0".repeat(24)}${event.decodedArguments.implementation.slice(2).toLowerCase()}`);

      const registeredChecks = new Map(registered.investigation.checks.map((check) => [check.id, check]));
      for (const check of profile.receipt.checks) {
        const policy = registeredChecks.get(check.id);
        const fixtureField = fixtureFields[profile.id][check.id];
        const rawResult = investigation[fixtureField];
        const expectedTag = blockTag(policy.block === "previous" ? registered.investigation.previousBlock : registered.investigation.upgradeBlock);

        expect(check.method).toBe(policy.method);
        expect(check.blockTag).toBe(expectedTag);
        expect(check.required).toBe(policy.required);
        expect(check.assertion.matches).toBe(true);
        expect(check.status).toBe("passed");

        if (policy.kind === "storage-address") {
          expect(check.parameters.address.toLowerCase()).toBe(policy.address.toLowerCase());
          expect(check.parameters.slot).toBe(policy.slot);
          expect(check.result).toEqual({ kind: "address", value: check.assertion.actual });
          expect(check.result.value.toLowerCase()).toBe(addressFromWord(rawResult));
          expect(check.assertion.expected.toLowerCase()).toBe(policy.expectedAddress.toLowerCase());
        } else if (policy.kind === "implementation-code") {
          expect(check.parameters.address.toLowerCase()).toBe(event.decodedArguments.implementation.toLowerCase());
          expect(check.result).toMatchObject({ kind: "bytecode", present: true, byteLength: rawResult });
          expect(check.assertion.expected).toBe(`${policy.expectedByteLength} bytes`);
          expect(check.assertion.actual).toBe(`${rawResult} bytes`);
          if (investigation.implementationCodeHash) expect(check.result.hash).toBe(investigation.implementationCodeHash);
          else expect(check.result.hash).toBeNull();
        } else if (policy.kind === "call-address") {
          expect(check.parameters).toEqual({ to: policy.to, data: policy.data });
          expect(check.result).toEqual({ kind: "address", value: check.assertion.actual });
          expect(check.result.value.toLowerCase()).toBe(addressFromWord(rawResult));
          expect(check.assertion.expected.toLowerCase()).toBe(policy.expectedAddress.toLowerCase());
        } else {
          expect(check.parameters).toEqual({ to: policy.to, data: policy.data });
          expect(check.result).toEqual({ kind: "uint256", value: check.assertion.actual });
          expect(check.result.value).toBe(BigInt(rawResult).toString());
          expect(check.assertion.expected).toBe(policy.expectedValue);
        }
      }

      const addresses = new Map(profile.addresses.map((entry) => [entry.key, entry]));
      expect(addresses.get("emitter")).toMatchObject({
        address: registered.target.primaryContract.address,
        role: registered.target.primaryContract.role,
      });
      expect(addresses.get("implementation").address.toLowerCase()).toBe(registered.expectedFixture.implementationAfter.toLowerCase());
      expect(addresses.get("sender").address.toLowerCase()).toBe(transaction.from.toLowerCase());
      expect(addresses.get("recipient").address.toLowerCase()).toBe(transaction.to.toLowerCase());
      for (const related of registered.target.relatedContracts) expect(addresses.get(related.key)).toMatchObject(related);

      expect(profile.receipt.limitations.every((limitation) => limitation.length > 20)).toBe(true);
      expect(fixtureReadme).toMatch(/does not (?:prove|establish)/i);
      if (profile.id === "aave-v3-base-core") {
        expect(registered.investigation.checks.filter(({ required }) => !required).map(({ id }) => id)).toEqual([
          "pool-revision-before",
          "pool-revision-at-upgrade",
        ]);
        expect(profile.receipt.limitations.join(" ")).toContain("POOL_REVISION() is optional");
      } else {
        const specificLimitation = profile.limitations.at(-1);
        for (const term of profile.id.startsWith("compound") ? ["governance intent", "market configuration"] : ["remote peers", "DVNs", "SyncPool"]) {
          expect(specificLimitation).toContain(term);
          expect(normalizedReadme).toContain(term);
        }
      }
    }
  });

  it("keeps fixture and live source labels explicit", () => {
    const complete = { scanStatus: "complete", evidence: { status: "complete", upgradeInvestigation: { evidenceStatus: "complete", disposition: "corroborated" } } };
    expect(investigationStateLabel(complete, "verified-fixture")).toBe("Verified fixture replay");
    expect(investigationStateLabel(complete, "live")).toBe("Live RPC investigation");
    expect(investigationStateLabel({ ...complete, scanStatus: "partial" }, "live")).toBe("Incomplete investigation");
    expect(investigationStateLabel({ scanStatus: "failed" }, "live")).toBe("Failed investigation");
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
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
    expect(html).toContain("Verify a protocol upgrade from event to receipt.");
    expect(html).toContain("Watchtower checks a configured Base upgrade at exact historical blocks");
    expect(html).toContain("Decide / Learn");
    expect(html).toContain("Command / Inspect");
    expect(html).toContain("Only these registered profiles can be selected");
    expect(html).not.toContain('type="text"');
    expect(html).toContain('id="case-journey"');
    expect(css).toContain("--color-accent: #245f52");
    expect(css).toContain("--space-6: 1.5rem");
    expect(css).toContain("--text-display: clamp(3rem, 8vw, 7rem)");
    expect(css).toContain(".profile-option { min-width: 0; width: 100%; display: grid");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain(".archive-table td::before");
    expect(css).toContain(".investigation-shell { grid-template-columns: 1fr; }");
  });

  it("keeps machine identifiers and investigation cards within mobile viewports", () => {
    const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

    expect(css).toContain(".trace-body > p { max-width: 100%");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain(".trace-stage { min-width: 0; max-width: 100%");
    expect(css).toContain(".check-record { min-width: 0; max-width: 100%");
    expect(css).toContain(".receipt-bar { min-width: 0; max-width: 100%");
    expect(css).toContain(".context-block ul { min-width: 0; max-width: 100%");
    expect(css).toContain(".context-block li { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }");
    expect(css).toContain(".failure-panel { grid-template-columns: minmax(0, 1fr); gap: 18px; }");
    expect(css).toContain(".trace-details { display: grid; grid-template-columns: minmax(0, 1fr); }");
    expect(css).not.toContain("overflow-x: hidden");
  });

  it("uses the shared design tokens for touched trace and archive components", () => {
    const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

    expect(css).toContain(".trace-link { padding: var(--space-2) var(--space-3)");
    expect(css).toContain(".trace-elapsed { color: var(--color-text-faint)");
    expect(css).toContain(".archive-table td { padding: var(--space-5) var(--space-3)");
    expect(css).toContain(".replay-action { padding: var(--space-2) var(--space-3)");
    expect(css).not.toContain("border-color: #d8a9a3");
    expect(css).not.toContain("border-color: #d9bf8f");
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
    expect(summarizeTraceProgression(trace)).toBe("6 of 6 stages complete");
    expect(trace[2].details[0]).toMatchObject({
      summary: expect.stringContaining("expected"),
      elapsedMs: expect.any(Number),
    });
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
    expect(summarizeTraceProgression(trace)).toContain("investigation incomplete");
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
    expect(summarizeTraceProgression(trace)).toBe("Investigation failed");
  });

  it("renders trace links, factual summaries, elapsed times, and fixture receipt downloads", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

    expect(app).toContain("stage.links.length");
    expect(app).toContain("trace-detail-summary");
    expect(app).toContain("trace-elapsed");
    expect(app).toContain('source === "verified-fixture"');
    expect(app).toContain("downloadReceipt(detail.evidence.investigationReceipt)");
  });
});

describe("browser receipt verification", () => {
  it("verifies each committed receipt by recomputing its canonical SHA-256 ID", async () => {
    for (const profile of archiveProfiles) {
      await expect(verifyReceipt(profile.receipt)).resolves.toMatchObject({ verified: true });
    }
  });

  it("keeps the ether.fi fixture receipt identical to the approved live canonical result", async () => {
    const fixture = archiveProfiles.find(({ id }) => id === "etherfi-base-weeth-oft");
    const manifest = JSON.parse(readFileSync(
      new URL("../fixtures/base/etherfi-weeth-oft-upgrade-23487559/manifest.json", import.meta.url),
      "utf8",
    ));
    const approvedLiveResult = structuredClone(fixture.receipt);
    approvedLiveResult.checks = approvedLiveResult.checks.map((item, index) => ({ ...item, elapsedMs: index + 1 }));

    expect(investigationReceiptSchema.parse(fixture.receipt)).toEqual(fixture.receipt);
    expect(manifest.canonicalReceiptId).toBe(fixture.receipt.receiptId);
    expect(await createReceiptId(approvedLiveResult)).toBe(fixture.receipt.receiptId);
    expect(approvedLiveResult.trigger).toEqual(fixture.receipt.trigger);
    expect(approvedLiveResult.plan).toEqual(fixture.receipt.plan);
    expect(approvedLiveResult.checks.map(({ elapsedMs: _elapsedMs, ...item }) => item)).toEqual(fixture.receipt.checks);
    expect(approvedLiveResult.errors).toEqual(fixture.receipt.errors);
    expect(approvedLiveResult.limitations).toEqual(fixture.receipt.limitations);
    expect(approvedLiveResult.explorerLinks).toEqual(fixture.receipt.explorerLinks);
  });

  it("keeps browser receipt IDs stable when measured check timings differ", async () => {
    const receipt = structuredClone(archiveProfiles[0].receipt);
    const originalId = await createReceiptId(receipt);
    receipt.checks = receipt.checks.map((item, index) => ({ ...item, elapsedMs: 50 + index }));

    expect(await createReceiptId(receipt)).toBe(originalId);
  });

  it("rejects a forged receipt ID", async () => {
    const forged = structuredClone(archiveProfiles[0].receipt);
    forged.receiptId = `receipt_${"0".repeat(64)}`;

    await expect(verifyReceipt(forged)).resolves.toMatchObject({ verified: false });
  });

  it("keeps canonical receipt IDs stable across Ethereum address casing", async () => {
    const receipt = structuredClone(archiveProfiles[2].receipt);
    const lowercaseAddresses = (value) => {
      if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(lowercaseAddresses);
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, lowercaseAddresses(item)]));
    };
    const lowercase = lowercaseAddresses(receipt);

    expect(normalizeEvmAddress("0xde8a2c33655aca88f258988ed74d1511876343d1")).toBe("0xde8A2C33655ACA88f258988ED74D1511876343D1");
    await expect(createReceiptId(lowercase)).resolves.toBe(receipt.receiptId);
    await expect(verifyReceipt(lowercase)).resolves.toMatchObject({ verified: true });
  });

  it("renders a visible browser verification action and both outcomes", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

    expect(app).toContain('"Verify receipt"');
    expect(app).toContain('"Receipt verified"');
    expect(app).toContain('"Receipt verification failed"');
    expect(app).toContain('check.result.hash ?? "Not recorded"');
  });
});
