import { describe, expect, it } from "vitest";

import { archiveProfiles } from "../public/archive-data.js";
import { buildFixtureDetail } from "../public/view-model.js";
import { scanResultSchema } from "../src/domain/schemas.js";
import { evaluateEvidenceIntegrity } from "../src/investigation/integrity.js";
import { createReceiptId, createScanId } from "../src/pipeline/ids.js";

function fixtureScan(profile = archiveProfiles[0]) {
  const detail = buildFixtureDetail(profile);
  return scanResultSchema.parse({
    scanId: createScanId(8453, profile.id, BigInt(profile.block.number), BigInt(profile.block.number)),
    targetId: profile.id,
    range: { fromBlock: profile.block.number, toBlock: profile.block.number },
    status: "complete",
    alerts: [],
    evidence: [detail.evidence],
    failures: [],
  });
}

function evaluate(result, source = "fixture", provenance = source === "live" ? "live-rpc" : "verified-fixture") {
  return evaluateEvidenceIntegrity({ result, source, provenance });
}

describe("evidence integrity lab", () => {
  it("verifies all committed fixtures while keeping fixture provenance explicit", () => {
    for (const profile of archiveProfiles) {
      const result = evaluate(fixtureScan(profile));
      expect(result).toMatchObject({
        outcome: "FIXTURE_ONLY",
        source: { declared: "fixture", provenance: "verified-fixture", consistent: true },
        receipt: { present: true, verified: true, receiptId: profile.receipt.receiptId },
      });
      expect(result.failedPaths).toEqual([]);
      expect(result.matchedPaths).toEqual(expect.arrayContaining([
        "target.profileId",
        "network.chainId",
        "block.number",
        "block.hash",
        "transaction.hash",
        "event.emitter",
        "event.signature",
        "event.decodedArguments.implementation",
        "investigation.plan",
        "severity.result",
      ]));
    }
  });

  it("corroborates a live-shaped result without changing the receipt", () => {
    const result = evaluate(fixtureScan(), "live", "live-rpc");
    expect(result.outcome).toBe("CORROBORATED");
    expect(result.receipt.verified).toBe(true);
    expect(result.source.consistent).toBe(true);
  });

  it("preserves a valid deterministic contradiction as CONTRADICTED", () => {
    const scan = structuredClone(fixtureScan());
    const evidence = scan.evidence[0];
    const implementation = `0x${"5".repeat(40)}`;
    evidence.event.decodedArguments.implementation = implementation;
    evidence.severity.ruleId = "target-is-not-approved";
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

    const result = evaluate(scan, "live", "live-rpc");
    expect(result.outcome).toBe("CONTRADICTED");
    expect(result.receipt.verified).toBe(true);
    expect(result.failedPaths).toEqual(expect.arrayContaining([
      "event.decodedArguments.implementation",
      "checks[1].result",
    ]));
  });

  it.each([
    ["transaction.hash", (scan) => { scan.evidence[0].transaction.hash = `0x${"1".repeat(64)}`; }],
    ["block.number", (scan) => { scan.evidence[0].block.number = "41105889"; }],
    ["block.hash", (scan) => { scan.evidence[0].block.hash = `0x${"2".repeat(64)}`; }],
    ["event.emitter", (scan) => { scan.evidence[0].log.emitter = `0x${"3".repeat(40)}`; }],
    ["event.signature", (scan) => { scan.evidence[0].event.signature = "Changed(address)"; }],
    ["event.decodedArguments.implementation", (scan) => { scan.evidence[0].event.decodedArguments.implementation = `0x${"4".repeat(40)}`; }],
  ])("refuses a changed %s with an exact evidence path", (path, mutate) => {
    const scan = structuredClone(fixtureScan());
    mutate(scan);
    const result = evaluate(scan, "live", "live-rpc");
    expect(result.outcome).toBe("EVIDENCE_MISMATCH");
    expect(result.failedPaths).toContain(path);
  });

  it("refuses altered check results and severity instead of corroborating", () => {
    const alteredCheck = structuredClone(fixtureScan());
    alteredCheck.evidence[0].upgradeInvestigation.checks[2].result = {
      kind: "bytecode",
      present: true,
      byteLength: "1",
      hash: null,
    };
    alteredCheck.evidence[0].upgradeInvestigation.checks[2].assertion.actual = "1 bytes";
    const checkResult = evaluate(alteredCheck, "live", "live-rpc");
    expect(checkResult.outcome).toBe("EVIDENCE_MISMATCH");
    expect(checkResult.failedPaths).toContain("checks[2].result");

    const alteredSeverity = structuredClone(fixtureScan());
    alteredSeverity.evidence[0].severity.result = "suspicious";
    const severityResult = evaluate(alteredSeverity, "live", "live-rpc");
    expect(severityResult.outcome).toBe("EVIDENCE_MISMATCH");
    expect(severityResult.failedPaths).toContain("severity.result");
  });

  it("rejects receipt tampering and out-of-scope checks", () => {
    const tamperedReceipt = structuredClone(fixtureScan());
    tamperedReceipt.evidence[0].investigationReceipt.limitations[0] = "Changed after issuance.";
    const receiptResult = evaluate(tamperedReceipt, "live", "live-rpc");
    expect(receiptResult.outcome).toBe("INVALID_RECEIPT");
    expect(receiptResult.receipt.verified).toBe(false);

    const outOfScope = structuredClone(fixtureScan());
    outOfScope.evidence[0].upgradeInvestigation.checks[0].id = "governor-before";
    outOfScope.evidence[0].investigationReceipt.checks[0].id = "governor-before";
    const scopeResult = evaluate(outOfScope, "live", "live-rpc");
    expect(scopeResult.outcome).toBe("INVALID_RECEIPT");
    expect(scopeResult.refusalCode).toBe("malformed-receipt-or-evidence");
  });

  it("refuses fixture/live provenance confusion", () => {
    const scan = fixtureScan();
    expect(evaluate(scan, "live", "verified-fixture")).toMatchObject({
      outcome: "EVIDENCE_MISMATCH",
      refusalCode: "fixture-presented-as-live",
      source: { consistent: false },
    });
    expect(evaluate(scan, "fixture", "live-rpc")).toMatchObject({
      outcome: "EVIDENCE_MISMATCH",
      refusalCode: "live-presented-as-fixture",
      source: { consistent: false },
    });
  });

  it("separates RPC unavailability, malformed responses, and incomplete evidence", () => {
    const rpcUnavailable = scanResultSchema.parse({
      scanId: "scan_rpc",
      targetId: "aave-v3-base-core",
      range: { fromBlock: "41105890", toBlock: "41105890" },
      status: "failed",
      alerts: [],
      evidence: [],
      failures: [{ code: "chain-id-rpc-dns", stage: "rpc", category: "dns", message: "RPC unavailable." }],
    });
    expect(evaluate(rpcUnavailable, "live", "live-rpc")).toMatchObject({
      outcome: "RPC_UNAVAILABLE",
      refusalCode: "rpc-dns",
    });

    expect(evaluate({}, "live", "live-rpc")).toMatchObject({
      outcome: "INCOMPLETE",
      refusalCode: "malformed-evidence",
    });

    const incomplete = structuredClone(fixtureScan());
    incomplete.status = "partial";
    incomplete.evidence[0].status = "incomplete";
    incomplete.evidence[0].errors = [{ code: "block-evidence-dns", message: "Block unavailable." }];
    incomplete.evidence[0].investigationReceipt = null;
    expect(evaluate(incomplete, "live", "live-rpc")).toMatchObject({
      outcome: "INCOMPLETE",
      refusalCode: "missing-receipt",
    });
  });

  it("keeps receipt verification separate from the broader evidence proof", () => {
    const result = evaluate(fixtureScan(), "live", "live-rpc");
    expect(result.receipt).toEqual(expect.objectContaining({ verified: true }));
    expect(result.expected).toHaveProperty("plan");
    expect(result.observed).toHaveProperty("checks");
    expect(result.message).toContain("canonical receipt");
  });
});
