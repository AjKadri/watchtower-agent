import { describe, expect, it, vi } from "vitest";

import { archiveProfiles } from "../public/archive-data.js";
import { createPortableArtifact, verifyPortableIntegrityArtifact, verifyPortableIntegrityText } from "../public/portable-integrity-verifier.js";
import { buildFixtureDetail } from "../public/view-model.js";
import { scanResultSchema } from "../src/domain/schemas.js";
import { createScanId, createReceiptId } from "../src/pipeline/ids.js";

function fixtureScan(profile = archiveProfiles[2]) {
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

async function fixtureArtifact(profile = archiveProfiles[2], source = { declared: "fixture", provenance: "verified-fixture" }) {
  return createPortableArtifact(fixtureScan(profile), source);
}

async function reissue(scan, source = { declared: "live", provenance: "live-rpc" }) {
  return createPortableArtifact(scan, source);
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
    const result = await verifyPortableIntegrityArtifact(await reissue(scan));

    expect(result.outcome).toBe("EVIDENCE_MISMATCH");
    expect(result.failedPaths).toContain(path);
  });

  it("preserves a deterministic contradiction", async () => {
    const scan = fixtureScan();
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

    const result = await verifyPortableIntegrityArtifact(await reissue(scan));

    expect(result.outcome).toBe("CONTRADICTED");
    expect(result.failedPaths).toEqual(expect.arrayContaining([
      "event.decodedArguments.implementation",
      "checks[1].result",
    ]));
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
