import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { archiveProfiles } from "../public/archive-data.js";
import { createPortableArtifact, verifyPortableIntegrityArtifact, verifyPortableIntegrityText } from "../public/portable-integrity-verifier.js";
import { buildFixtureDetail } from "../public/view-model.js";
import { scanResultSchema } from "../src/domain/schemas.js";
import { evaluateEvidenceIntegrity } from "../src/investigation/integrity.js";
import { createScanId, createReceiptId } from "../src/pipeline/ids.js";

function fixtureAlertId(transactionHash, logIndex, detectorId) {
  return `alert_${createHash("sha256").update(["8453", transactionHash.toLowerCase(), String(logIndex), detectorId].join("\n")).digest("hex")}`;
}

function fixtureScan(profile = archiveProfiles[2]) {
  const detail = buildFixtureDetail(profile);
  const scanId = createScanId(8453, profile.id, BigInt(profile.block.number), BigInt(profile.block.number));
  const alertId = fixtureAlertId(detail.evidence.transaction.hash, Number(detail.evidence.log.index), detail.evidence.detector.id);
  return scanResultSchema.parse({
    scanId,
    targetId: profile.id,
    range: { fromBlock: profile.block.number, toBlock: profile.block.number },
    status: "complete",
    alerts: [{
      ...detail.alert,
      id: alertId,
      scanId,
      evidenceId: detail.evidence.id,
      incidentClass: "contract_upgrade",
      eventType: "proxy_upgraded",
      severityRuleId: detail.evidence.severity.ruleId,
    }],
    evidence: [detail.evidence],
    failures: [],
  });
}

async function fixtureArtifact(profile = archiveProfiles[2], source = { declared: "fixture", provenance: "verified-fixture" }) {
  return createPortableArtifact(fixtureScan(profile), source);
}

async function reissue(scan, source = { declared: "live", provenance: "live-rpc" }) {
  return createPortableArtifact(scan, source);
}

function recomputeReceipt(scan) {
  const receipt = scan.evidence[0]?.investigationReceipt;
  if (receipt) receipt.receiptId = createReceiptId(receipt);
  return scan;
}

function testPlan(profile, key) {
  if (profile.plans?.[key]) return structuredClone(profile.plans[key]);
  const approved = structuredClone(profile.receipt.plan);
  if (key === "approved") return approved;
  if (key === "escalation") {
    return {
      ...approved,
      id: "escalate-unapproved-upgrade",
      selectionReason: {
        code: "unapproved-target",
        text: "The deterministic severity rule identified a zero or unapproved decoded implementation.",
      },
      selectedChecks: approved.selectedChecks.slice(0, 4),
      skippedChecks: approved.selectedChecks.slice(4),
      capabilityBudget: {
        maximumReads: 4,
        capabilities: [
          { name: "historical-storage-read", maximumUses: 2 },
          { name: "historical-code-read", maximumUses: 1 },
          { name: "historical-contract-call", maximumUses: 1 },
        ],
      },
    };
  }
  return {
    ...approved,
    id: "stop-incomplete",
    selectionReason: {
      code: "trigger-evidence-incomplete",
      text: "Complete trigger evidence is unavailable, so no historical investigation reads are permitted.",
    },
    selectedChecks: [],
    skippedChecks: approved.selectedChecks,
    capabilityBudget: { maximumReads: 0, capabilities: [] },
  };
}

function bindPlan(scan, plan, disposition, checks) {
  const evidence = scan.evidence[0];
  evidence.upgradeInvestigation.plan = structuredClone(plan);
  evidence.upgradeInvestigation.disposition = disposition;
  evidence.upgradeInvestigation.evidenceStatus = disposition === "incomplete" ? "incomplete" : "complete";
  evidence.upgradeInvestigation.checks = structuredClone(checks);
  evidence.investigationReceipt.plan = structuredClone(plan);
  evidence.investigationReceipt.finalDisposition = disposition;
  evidence.investigationReceipt.checks = structuredClone(checks);
  evidence.investigationReceipt.errors = checks.flatMap((check) => check.failure ? [check.failure] : []);
  return recomputeReceipt(scan);
}

function unapprovedEscalationScan(profile = archiveProfiles[2]) {
  const scan = fixtureScan(profile);
  const evidence = scan.evidence[0];
  const implementation = `0x${"5".repeat(40)}`;
  evidence.event.decodedArguments.implementation = implementation;
  evidence.severity.ruleId = "target-is-not-approved";
  evidence.severity.inputs = { implementation, approved: "false", isZeroAddress: "false" };
  evidence.severity.result = "suspicious";
  evidence.investigationReceipt.trigger.decodedArguments.implementation = implementation;
  evidence.investigationReceipt.trigger.detector.severityRuleId = "target-is-not-approved";
  evidence.investigationReceipt.trigger.detector.severity = "suspicious";
  const checks = evidence.upgradeInvestigation.checks.filter(({ id }) => testPlan(profile, "escalation").selectedChecks.includes(id));
  const implementationCheck = checks.find(({ id }) => id === "implementation-at-upgrade");
  implementationCheck.result = { kind: "address", value: implementation };
  implementationCheck.assertion.actual = implementation;
  implementationCheck.assertion.matches = false;
  implementationCheck.status = "mismatch";
  const bytecodeCheck = checks.find(({ id }) => id === "implementation-bytecode");
  bytecodeCheck.parameters.address = implementation;
  bytecodeCheck.result.byteLength = "1";
  bytecodeCheck.assertion.actual = "1 bytes";
  bytecodeCheck.assertion.matches = false;
  bytecodeCheck.status = "mismatch";
  scan.alerts[0].severity = "suspicious";
  scan.alerts[0].severityRuleId = "target-is-not-approved";
  scan.alerts[0].investigation.interpretation.severityRuleId = "target-is-not-approved";
  bindPlan(scan, testPlan(profile, "escalation"), "contradicted", checks);
  return scan;
}

describe("portable integrity artifact verifier", () => {
  it("verifies a valid fixture artifact without network access", async () => {
    const result = await verifyPortableIntegrityArtifact(await fixtureArtifact());

    expect(result).toMatchObject({
      status: "verified",
      verified: true,
      outcome: "FIXTURE_ONLY",
      refusalCode: null,
      provenanceAuthenticated: false,
    });
    expect(result.failedPaths).toEqual([]);
  });

  it("verifies a live-shaped artifact while preserving unauthenticated provenance", async () => {
    const result = await verifyPortableIntegrityArtifact(await fixtureArtifact(archiveProfiles[2], {
      declared: "live",
      provenance: "live-rpc",
    }));

    expect(result).toMatchObject({
      status: "verified",
      verified: true,
      outcome: "CORROBORATED",
      provenanceAuthenticated: false,
    });
  });

  it("matches server integrity outcomes for every committed profile fixture", async () => {
    for (const profile of archiveProfiles) {
      const scan = fixtureScan(profile);
      const portable = await verifyPortableIntegrityArtifact(await reissue(scan, { declared: "fixture", provenance: "verified-fixture" }));
      const server = evaluateEvidenceIntegrity({ result: scan, source: "fixture", provenance: "verified-fixture" });
      expect(portable.outcome).toBe(server.outcome);
      expect(portable.failedPaths).toEqual(server.failedPaths);
    }
  });

  it.each([
    ["approved", "corroborated", (profile) => fixtureScan(profile)],
    ["escalation", "contradicted", (profile) => unapprovedEscalationScan(profile)],
    ["incomplete", "incomplete", (profile) => {
      const scan = fixtureScan(profile);
      const evidence = scan.evidence[0];
      bindPlan(scan, testPlan(profile, "incomplete"), "incomplete", []);
      evidence.investigationReceipt.errors = [];
      return scan;
    }],
  ])("matches server outcome for the registered %s plan", async (_label, expectedOutcome, buildScan) => {
    for (const profile of archiveProfiles) {
      const scan = buildScan(profile);
      const portable = await verifyPortableIntegrityArtifact(await reissue(scan));
      const server = evaluateEvidenceIntegrity({ result: scan, source: "live", provenance: "live-rpc" });
      expect(portable.outcome).toBe(expectedOutcome.toUpperCase());
      expect(portable.outcome).toBe(server.outcome);
    }
  });

  it("keeps a reissued stop-incomplete receipt incomplete", async () => {
    const scan = fixtureScan();
    bindPlan(scan, testPlan(archiveProfiles[2], "incomplete"), "contradicted", []);

    const portable = await verifyPortableIntegrityArtifact(await reissue(scan));
    const server = evaluateEvidenceIntegrity({ result: scan, source: "live", provenance: "live-rpc" });

    expect(portable.outcome).toBe("INVALID_RECEIPT");
    expect(portable.outcome).not.toBe("CORROBORATED");
    expect(server.outcome).toBe("INVALID_RECEIPT");
  });

  it.each([
    ["wrong plan ID", (scan) => {
      const evidence = scan.evidence[0];
      const wrong = { ...structuredClone(evidence.upgradeInvestigation.plan), id: "stop-incomplete", selectedChecks: [], skippedChecks: evidence.upgradeInvestigation.plan.selectedChecks };
      bindPlan(scan, wrong, "incomplete", []);
    }],
    ["cross-profile plan", (scan) => {
      const wrong = testPlan(archiveProfiles[0], "approved");
      bindPlan(scan, wrong, "corroborated", scan.evidence[0].upgradeInvestigation.checks);
    }],
    ["changed plan version", (scan) => {
      const changed = { ...structuredClone(scan.evidence[0].upgradeInvestigation.plan), version: "2.0.0" };
      bindPlan(scan, changed, "corroborated", scan.evidence[0].upgradeInvestigation.checks);
    }],
    ["changed plan checks", (scan) => {
      const changed = { ...structuredClone(scan.evidence[0].upgradeInvestigation.plan), selectedChecks: ["implementation-before"] };
      bindPlan(scan, changed, "corroborated", scan.evidence[0].upgradeInvestigation.checks);
    }],
    ["changed plan order", (scan) => {
      const changed = { ...structuredClone(scan.evidence[0].upgradeInvestigation.plan), selectedChecks: [...scan.evidence[0].upgradeInvestigation.plan.selectedChecks].reverse() };
      bindPlan(scan, changed, "corroborated", scan.evidence[0].upgradeInvestigation.checks);
    }],
    ["changed plan method", (scan) => { scan.evidence[0].upgradeInvestigation.checks[0].method = "eth_call"; recomputeReceipt(scan); }],
    ["changed plan parameters", (scan) => { scan.evidence[0].upgradeInvestigation.checks[0].parameters.slot = "0xdeadbeef"; recomputeReceipt(scan); }],
    ["changed plan block tag", (scan) => { scan.evidence[0].upgradeInvestigation.checks[0].blockTag = "0x1"; recomputeReceipt(scan); }],
  ])("refuses %s without accepting it as a valid conclusion", async (_label, mutate) => {
    const scan = fixtureScan();
    mutate(scan);
    const portable = await verifyPortableIntegrityArtifact(await reissue(scan));
    if (_label === "changed plan version") {
      expect(portable).toMatchObject({ status: "refused", refusalCode: "malformed-artifact" });
      return;
    }
    expect(portable.outcome).toBe("EVIDENCE_MISMATCH");
    expect(portable.outcome).not.toBe("CORROBORATED");
    expect(portable.outcome).not.toBe("CONTRADICTED");
  });

  it("refuses raw artifact tampering before semantic verification", async () => {
    const artifact = await fixtureArtifact();
    artifact.scanResult.evidence[0].block.number = "1";

    await expect(verifyPortableIntegrityArtifact(artifact)).resolves.toMatchObject({
      status: "refused",
      verified: false,
      refusalCode: "artifact-id-mismatch",
    });
  });

  it("refuses a changed receipt after the artifact ID is recomputed", async () => {
    const scan = fixtureScan();
    scan.evidence[0].investigationReceipt.limitations[0] = "Changed after issuance.";
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));

    expect(result).toMatchObject({ outcome: "INVALID_RECEIPT", refusalCode: "receipt-id-mismatch" });
  });

  it.each([
    ["evidence", (scan) => { scan.evidence[0].block.hash = `0x${"1".repeat(64)}`; }, "block.hash"],
    ["check result", (scan) => {
      scan.evidence[0].upgradeInvestigation.checks[2].result.byteLength = "1";
      scan.evidence[0].upgradeInvestigation.checks[2].assertion.actual = "1 bytes";
    }, "checks[2].result"],
    ["severity", (scan) => { scan.evidence[0].severity.result = "suspicious"; }, "severity.result"],
    ["target profile", (scan) => { scan.targetId = "aave-v3-base-core"; }, "target.profileId"],
    ["block range", (scan) => { scan.range.fromBlock = "23487558"; }, "scan.range.fromBlock"],
    ["check order", (scan) => { scan.evidence[0].upgradeInvestigation.checks.reverse(); }, "checks"],
    ["check parameters", (scan) => { scan.evidence[0].upgradeInvestigation.checks[3].parameters.data = "0xdeadbeef"; }, "checks[3].parameters"],
  ])("refuses changed %s with an exact path", async (_label, mutate, path) => {
    const scan = fixtureScan();
    mutate(scan);
    recomputeReceipt(scan);
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));

    expect(result.outcome).toBe("EVIDENCE_MISMATCH");
    expect(result.failedPaths).toContain(path);
  });

  it.each([
    ["transaction sender", (scan) => { scan.evidence[0].transaction.sender = `0x${"1".repeat(40)}`; }, "transaction.sender"],
    ["transaction recipient", (scan) => { scan.evidence[0].transaction.recipient = `0x${"2".repeat(40)}`; }, "transaction.recipient"],
    ["transaction status", (scan) => { scan.evidence[0].transaction.receiptStatus = "reverted"; }, "transaction.receiptStatus"],
    ["log index", (scan) => { scan.evidence[0].log.index = "191"; }, "log.index"],
    ["topic zero", (scan) => { scan.evidence[0].log.topic0 = `0x${"3".repeat(64)}`; }, "log.topic0"],
    ["raw topic", (scan) => { scan.evidence[0].log.rawTopics[1] = `0x${"4".repeat(64)}`; }, "log.rawTopics"],
    ["receipt transaction sender", (scan) => { scan.evidence[0].investigationReceipt.trigger.transaction.sender = `0x${"5".repeat(40)}`; }, "receipt.trigger.transaction.sender"],
    ["receipt transaction recipient", (scan) => { scan.evidence[0].investigationReceipt.trigger.transaction.recipient = `0x${"6".repeat(40)}`; }, "receipt.trigger.transaction.recipient"],
    ["receipt transaction status", (scan) => { scan.evidence[0].investigationReceipt.trigger.transaction.receiptStatus = "reverted"; }, "receipt.trigger.transaction.receiptStatus"],
    ["receipt log index", (scan) => { scan.evidence[0].investigationReceipt.trigger.log.index = "191"; }, "receipt.trigger.log.index"],
    ["receipt topic zero", (scan) => { scan.evidence[0].investigationReceipt.trigger.log.topic0 = `0x${"7".repeat(64)}`; }, "receipt.trigger.log.topic0"],
    ["receipt raw topic", (scan) => { scan.evidence[0].investigationReceipt.trigger.log.rawTopics[1] = `0x${"8".repeat(64)}`; }, "receipt.trigger.log.rawTopics"],
    ["receipt event type", (scan) => { scan.evidence[0].investigationReceipt.trigger.eventType = "other"; }, "receipt.trigger.eventType"],
    ["receipt detector rule", (scan) => { scan.evidence[0].investigationReceipt.trigger.detector.severityRuleId = "target-is-not-approved"; }, "receipt.trigger.detector.severityRuleId"],
    ["receipt detector severity", (scan) => { scan.evidence[0].investigationReceipt.trigger.detector.severity = "suspicious"; }, "receipt.trigger.detector.severity"],
    ["receipt detector ID", (scan) => { scan.evidence[0].investigationReceipt.trigger.detector.id = "forged-detector"; }, "receipt.trigger.detector.id"],
    ["configured address role", (scan) => { scan.evidence[0].relevantAddresses[0].role = "forged-role"; }, "relevantAddresses[0].role"],
    ["source link", (scan) => { scan.evidence[0].sources.transaction = "https://example.invalid/forged"; }, "sources.transaction"],
  ])("refuses changed profile-bound %s with an exact path", async (_label, mutate, path) => {
    const scan = fixtureScan();
    mutate(scan);
    recomputeReceipt(scan);
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));

    if (_label === "receipt event type") {
      expect(result).toMatchObject({ outcome: "INVALID_RECEIPT", refusalCode: "malformed-receipt" });
    } else {
      expect(result.outcome).toBe("EVIDENCE_MISMATCH");
      expect(result.failedPaths).toContain(path);
    }
  });

  it("rejects unknown top-level fields with stale and recomputed artifact IDs", async () => {
    const stale = await fixtureArtifact();
    stale.debug = "forged";
    await expect(verifyPortableIntegrityArtifact(stale)).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });

    const recomputed = await fixtureArtifact();
    recomputed.debug = "forged";
    recomputed.artifactId = await import("../public/portable-integrity-verifier.js").then(({ createPortableArtifactId }) => createPortableArtifactId(recomputed));
    await expect(verifyPortableIntegrityArtifact(recomputed)).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });
  });

  it("rejects unknown nested fields after artifact reissuance", async () => {
    const scan = fixtureScan();
    scan.evidence[0].debug = "forged";
    await expect(verifyPortableIntegrityArtifact(await reissue(scan))).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });

    const receiptScan = fixtureScan();
    receiptScan.evidence[0].investigationReceipt.trigger.debug = "forged";
    recomputeReceipt(receiptScan);
    await expect(verifyPortableIntegrityArtifact(await reissue(receiptScan))).resolves.toMatchObject({
      status: "verified",
      outcome: "INVALID_RECEIPT",
      refusalCode: "malformed-receipt",
    });
  });

  it("preserves a deterministic contradiction", async () => {
    const scan = fixtureScan();
    const evidence = scan.evidence[0];
    const implementation = `0x${"5".repeat(40)}`;
    evidence.event.decodedArguments.implementation = implementation;
    evidence.severity.ruleId = "target-is-not-approved";
    evidence.severity.inputs = { implementation, approved: "false", isZeroAddress: "false" };
    evidence.severity.result = "suspicious";
    evidence.upgradeInvestigation.disposition = "contradicted";
    const implementationCheck = evidence.upgradeInvestigation.checks.find(({ id }) => id === "implementation-at-upgrade");
    implementationCheck.result = { kind: "address", value: implementation };
    implementationCheck.assertion.actual = implementation;
    implementationCheck.assertion.matches = false;
    implementationCheck.status = "mismatch";
    const bytecodeCheck = evidence.upgradeInvestigation.checks.find(({ id }) => id === "implementation-bytecode");
    bytecodeCheck.parameters.address = implementation;
    bytecodeCheck.assertion.matches = false;
    bytecodeCheck.status = "mismatch";
    const receipt = evidence.investigationReceipt;
    receipt.trigger.decodedArguments.implementation = implementation;
    receipt.trigger.detector.severityRuleId = "target-is-not-approved";
    receipt.trigger.detector.severity = "suspicious";
    receipt.checks = structuredClone(evidence.upgradeInvestigation.checks);
    receipt.finalDisposition = "contradicted";
    receipt.receiptId = createReceiptId(receipt);
    scan.alerts[0].severity = "suspicious";
    scan.alerts[0].severityRuleId = "target-is-not-approved";
    scan.alerts[0].investigation.interpretation.severityRuleId = "target-is-not-approved";

    const result = await verifyPortableIntegrityArtifact(await reissue(scan));

    expect(result.outcome).toBe("CONTRADICTED");
    expect(result.failedPaths).toEqual(expect.arrayContaining([
      "event.decodedArguments.implementation",
      "checks[1].result",
    ]));
  });

  it.each([
    "implementation-before",
    "implementation-at-upgrade",
    "implementation-bytecode",
    "endpoint-at-upgrade",
    "token-at-upgrade",
    "shared-decimals-at-upgrade",
  ])("preserves a contradiction for registered check %s", async (checkId) => {
    const scan = structuredClone(fixtureScan());
    const evidence = scan.evidence[0];
    const check = evidence.upgradeInvestigation.checks.find(({ id }) => id === checkId);
    evidence.upgradeInvestigation.disposition = "contradicted";
    if (check.result?.kind === "address") {
      check.result.value = `0x${"5".repeat(40)}`;
      check.assertion.actual = check.result.value;
    } else if (check.result?.kind === "uint256") {
      check.result.value = "999";
      check.assertion.actual = "999";
    } else if (check.result?.kind === "bytecode") {
      check.result.byteLength = "1";
      check.assertion.actual = "1 bytes";
    }
    check.assertion.matches = false;
    check.status = "mismatch";
    evidence.investigationReceipt.finalDisposition = "contradicted";
    evidence.investigationReceipt.checks = structuredClone(evidence.upgradeInvestigation.checks);
    recomputeReceipt(scan);

    const portable = await verifyPortableIntegrityArtifact(await reissue(scan));
    const server = evaluateEvidenceIntegrity({ result: scan, source: "live", provenance: "live-rpc" });
    expect(portable.outcome).toBe("CONTRADICTED");
    expect(server.outcome).toBe("CONTRADICTED");
    expect(portable.failedPaths).toContain(`checks[${evidence.upgradeInvestigation.checks.findIndex(({ id }) => id === checkId)}].result`);
  });

  it.each([
    ["method", (check) => { check.method = "eth_call"; }, "check-method-mismatch"],
    ["parameters", (check) => { check.parameters.data = "0xdeadbeef"; }, "check-parameters-mismatch"],
    ["block tag", (check) => { check.blockTag = "0x1"; }, "check-block-mismatch"],
    ["required flag", (check) => { check.required = false; }, "check-required-mismatch"],
    ["check ID", (check) => { check.id = "governor-before"; }, "check-out-of-scope"],
  ])("never treats changed check %s as contradiction", async (_label, mutate, serverCode) => {
    const scan = structuredClone(fixtureScan());
    const evidence = scan.evidence[0];
    evidence.upgradeInvestigation.disposition = "contradicted";
    const check = evidence.upgradeInvestigation.checks[1];
    mutate(check);
    evidence.investigationReceipt.finalDisposition = "contradicted";
    evidence.investigationReceipt.checks = structuredClone(evidence.upgradeInvestigation.checks);
    recomputeReceipt(scan);

    const portable = await verifyPortableIntegrityArtifact(await reissue(scan));
    const server = evaluateEvidenceIntegrity({ result: scan, source: "live", provenance: "live-rpc" });
    expect(portable.outcome).toBe("EVIDENCE_MISMATCH");
    expect(server.outcome).toBe("INVALID_RECEIPT");
    expect(portable.refusalCode).toBe("evidence-mismatch");
    expect(server.refusalCode).toBe("malformed-receipt-or-evidence");
    expect(portable.failedPaths.join(" ")).toContain("checks[1]");
    expect(serverCode).toBeTypeOf("string");
  });

  it("rejects reordered and unknown checks without contradiction", async () => {
    const reordered = fixtureScan();
    reordered.evidence[0].upgradeInvestigation.disposition = "contradicted";
    reordered.evidence[0].investigationReceipt.finalDisposition = "contradicted";
    reordered.evidence[0].upgradeInvestigation.checks.reverse();
    reordered.evidence[0].investigationReceipt.checks = structuredClone(reordered.evidence[0].upgradeInvestigation.checks);
    recomputeReceipt(reordered);
    await expect(verifyPortableIntegrityArtifact(await reissue(reordered))).resolves.toMatchObject({ outcome: "EVIDENCE_MISMATCH" });

    const unknown = fixtureScan();
    unknown.evidence[0].upgradeInvestigation.disposition = "contradicted";
    unknown.evidence[0].investigationReceipt.finalDisposition = "contradicted";
    unknown.evidence[0].upgradeInvestigation.checks[1].id = "governor-before";
    unknown.evidence[0].investigationReceipt.checks = structuredClone(unknown.evidence[0].upgradeInvestigation.checks);
    recomputeReceipt(unknown);
    await expect(verifyPortableIntegrityArtifact(await reissue(unknown))).resolves.toMatchObject({ outcome: "EVIDENCE_MISMATCH" });
  });

  it.each([
    ["all checks pass but declared contradicted", (scan) => {
      scan.evidence[0].upgradeInvestigation.disposition = "contradicted";
      scan.evidence[0].investigationReceipt.finalDisposition = "contradicted";
    }],
    ["a valid check mismatch but declared corroborated", (scan) => {
      const evidence = scan.evidence[0];
      const check = evidence.upgradeInvestigation.checks[1];
      check.result.value = `0x${"5".repeat(40)}`;
      check.assertion.actual = check.result.value;
      check.assertion.matches = false;
      check.status = "mismatch";
      evidence.upgradeInvestigation.disposition = "corroborated";
      evidence.investigationReceipt.finalDisposition = "corroborated";
      evidence.investigationReceipt.checks = structuredClone(evidence.upgradeInvestigation.checks);
    }],
  ])("refuses inconsistent declared disposition: %s", async (_label, mutate) => {
    const scan = fixtureScan();
    mutate(scan);
    recomputeReceipt(scan);
    const portable = await verifyPortableIntegrityArtifact(await reissue(scan));
    const server = evaluateEvidenceIntegrity({ result: scan, source: "live", provenance: "live-rpc" });
    expect(portable.outcome).toBe("INVALID_RECEIPT");
    expect(portable.refusalCode).toBe("malformed-receipt");
    expect(server.outcome).toBe("INVALID_RECEIPT");
  });

  it.each([
    ["non-empty errors", [{ code: "forged-error", message: "forged" }]],
    ["malformed error", [{ code: "forged-error", message: 7 }]],
    ["null error item", [null]],
  ])("never corroborates complete evidence with %s", async (_label, errors) => {
    const scan = fixtureScan();
    scan.evidence[0].errors = errors;
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));
    expect(result.outcome).not.toBe("CORROBORATED");
    expect(result.refusalCode).toBe(_label === "non-empty errors" ? "malformed-evidence" : "malformed-artifact");
  });

  it("preserves empty errors for complete evidence and requires errors for incomplete evidence", async () => {
    const complete = await verifyPortableIntegrityArtifact(await fixtureArtifact());
    expect(complete.outcome).toBe("FIXTURE_ONLY");

    const incomplete = fixtureScan();
    incomplete.status = "partial";
    incomplete.evidence[0].status = "incomplete";
    incomplete.evidence[0].errors = [{ code: "missing-block", message: "Block unavailable." }];
    incomplete.evidence[0].investigationReceipt = null;
    expect(await verifyPortableIntegrityArtifact(await reissue(incomplete))).toMatchObject({ outcome: "INCOMPLETE" });

    const failed = fixtureScan();
    failed.status = "failed";
    failed.evidence[0].investigationReceipt = null;
    const failedPortable = await verifyPortableIntegrityArtifact(await reissue(failed));
    const failedServer = evaluateEvidenceIntegrity({ result: failed, source: "live", provenance: "live-rpc" });
    expect(failedPortable).toMatchObject({ outcome: "RPC_UNAVAILABLE", refusalCode: "rpc-unavailable" });
    expect(failedServer).toMatchObject({ outcome: "RPC_UNAVAILABLE", refusalCode: "rpc-unavailable" });
  });

  it.each([
    ["implementation", "0x1111111111111111111111111111111111111111"],
    ["approved", "false"],
    ["isZeroAddress", "true"],
  ])("binds severity input %s", async (key, value) => {
    const scan = fixtureScan();
    scan.evidence[0].severity.inputs[key] = value;
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));
    expect(result.outcome).toBe("EVIDENCE_MISMATCH");
    expect(result.failedPaths).toContain(`severity.inputs`);
    expect(result.outcome).not.toBe("CONTRADICTED");
  });

  it.each([
    ["extra", (scan) => { scan.alerts.push(structuredClone(scan.alerts[0])); }],
    ["removed", (scan) => { scan.alerts = []; }],
    ["cross-profile", (scan) => { scan.alerts[0].targetId = "aave-v3-base-core"; }],
    ["wrong evidence ID", (scan) => { scan.alerts[0].evidenceId = "evidence_forged"; }],
    ["wrong severity", (scan) => { scan.alerts[0].severity = "high"; }],
    ["wrong status", (scan) => { scan.alerts[0].evidenceStatus = "incomplete"; }],
    ["wrong sources", (scan) => { scan.alerts[0].sources.transaction = "https://example.invalid/forged"; }],
  ])("refuses alert mutation: %s", async (_label, mutate) => {
    const scan = fixtureScan();
    mutate(scan);
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));
    expect(result.outcome).not.toBe("CORROBORATED");
    expect(result.outcome).not.toBe("FIXTURE_ONLY");
    expect(result.refusalCode).toBe("evidence-mismatch");
  });

  it("distinguishes incomplete and RPC-unavailable results", async () => {
    const incomplete = fixtureScan();
    incomplete.status = "partial";
    incomplete.evidence[0].status = "incomplete";
    incomplete.evidence[0].errors = [{ code: "block-evidence-dns", message: "Block unavailable." }];
    incomplete.evidence[0].investigationReceipt = null;
    expect(await verifyPortableIntegrityArtifact(await reissue(incomplete))).toMatchObject({
      outcome: "INCOMPLETE",
      refusalCode: "missing-receipt",
    });

    const unavailable = {
      scanId: createScanId(8453, "etherfi-base-weeth-oft", 23487559n, 23487559n),
      targetId: "etherfi-base-weeth-oft",
      range: { fromBlock: "23487559", toBlock: "23487559" },
      status: "failed",
      alerts: [],
      evidence: [],
      failures: [{ code: "chain-id-rpc-dns", stage: "rpc", category: "dns", message: "RPC unavailable." }],
    };
    const artifact = await createPortableArtifact(unavailable, { declared: "live", provenance: "live-rpc" });
    expect(await verifyPortableIntegrityArtifact(artifact)).toMatchObject({
      outcome: "RPC_UNAVAILABLE",
      refusalCode: "rpc-dns",
    });
  });

  it("refuses malformed and unsupported artifact envelopes", async () => {
    await expect(verifyPortableIntegrityText("{not-json")).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });
    const artifact = await fixtureArtifact();
    artifact.artifactVersion = 99;
    await expect(verifyPortableIntegrityArtifact(artifact)).resolves.toMatchObject({
      status: "refused",
      refusalCode: "unsupported-artifact-version",
    });
  });

  it("refuses malformed dispositions and malformed array items without throwing", async () => {
    const bogus = fixtureScan();
    bogus.evidence[0].upgradeInvestigation.disposition = "bogus";
    bogus.evidence[0].investigationReceipt.finalDisposition = "bogus";
    recomputeReceipt(bogus);
    await expect(verifyPortableIntegrityArtifact(await reissue(bogus))).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });

    const nullFailure = fixtureScan();
    nullFailure.failures = [null];
    await expect(verifyPortableIntegrityArtifact(await reissue(nullFailure))).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });

    const nullAlert = fixtureScan();
    nullAlert.alerts = [null];
    await expect(verifyPortableIntegrityArtifact(await reissue(nullAlert))).resolves.toMatchObject({
      status: "refused",
      refusalCode: "malformed-artifact",
    });
  });

  it("refuses unsupported receipt versions and fixture/live confusion", async () => {
    const unsupportedReceipt = fixtureScan();
    unsupportedReceipt.evidence[0].investigationReceipt.schemaVersion = 2;
    expect(await verifyPortableIntegrityArtifact(await reissue(unsupportedReceipt))).toMatchObject({
      outcome: "INVALID_RECEIPT",
      refusalCode: "unsupported-receipt-version",
    });

    const confusion = await fixtureArtifact();
    confusion.source = { declared: "live", provenance: "verified-fixture" };
    confusion.artifactId = await createPortableArtifact(confusion.scanResult, confusion.source).then(({ artifactId }) => artifactId);
    expect(await verifyPortableIntegrityArtifact(confusion)).toMatchObject({
      outcome: "EVIDENCE_MISMATCH",
      refusalCode: "fixture-presented-as-live",
    });
  });

  it("performs verification without fetch or external services", async () => {
    const fetchSpy = vi.fn(() => { throw new Error("network access is not allowed"); });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await verifyPortableIntegrityText(JSON.stringify(await fixtureArtifact()));
      expect(result.verified).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
