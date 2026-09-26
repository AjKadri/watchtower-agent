import { archiveProfiles } from "./archive-data.js";
import {
  createReceiptId,
  normalizeEvmAddresses,
  stableSerialize,
} from "./receipt-verifier.js";

export const PORTABLE_INTEGRITY_FORMAT = "watchtower-portable-integrity";
export const PORTABLE_INTEGRITY_VERSION = 1;

const ARTIFACT_ID_PATTERN = /^artifact_[0-9a-f]{64}$/;
const RECEIPT_ID_PATTERN = /^receipt_[0-9a-f]{64}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const RPC_CATEGORIES = new Set(["dns", "timeout", "rate-limit", "unavailable"]);
const REQUIRED_RECEIPT_FIELDS = [
  "receiptId",
  "schemaVersion",
  "trigger",
  "plan",
  "checks",
  "errors",
  "limitations",
  "finalDisposition",
  "explorerLinks",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(left, right) {
  try {
    return stableSerialize(normalizeEvmAddresses(left)) === stableSerialize(normalizeEvmAddresses(right));
  } catch {
    return Object.is(left, right);
  }
}

function result(status, outcome = null, refusalCode = null, details = {}) {
  return {
    status,
    verified: status === "verified",
    outcome,
    refusalCode,
    artifactId: details.artifactId ?? null,
    computedArtifactId: details.computedArtifactId ?? null,
    receiptId: details.receiptId ?? null,
    computedReceiptId: details.computedReceiptId ?? null,
    provenanceAuthenticated: false,
    matchedPaths: details.matchedPaths ?? [],
    failedPaths: details.failedPaths ?? [],
    ...details,
  };
}

function malformed(message, details = {}) {
  return result("refused", null, "malformed-artifact", { message, ...details });
}

function comparison(path, expected, observed, code = "evidence-mismatch") {
  const available = observed !== undefined && observed !== null;
  return {
    path,
    expected,
    observed: available ? observed : null,
    status: available ? (equal(expected, observed) ? "matched" : "mismatch") : "unavailable",
    code: available && equal(expected, observed) ? null : code,
  };
}

function comparisonSet(comparisons) {
  return {
    matchedPaths: comparisons.filter(({ status }) => status === "matched").map(({ path }) => path),
    failedPaths: comparisons.filter(({ status }) => status !== "matched").map(({ path }) => path),
  };
}

function sourceConsistent(source) {
  return (source.declared === "live" && source.provenance === "live-rpc")
    || (source.declared === "fixture" && source.provenance === "verified-fixture");
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalArtifactPayload(artifact) {
  return normalizeEvmAddresses({
    format: artifact.format,
    artifactVersion: artifact.artifactVersion,
    source: artifact.source,
    scanResult: artifact.scanResult,
  });
}

export async function createPortableArtifactId(artifact) {
  return `artifact_${await sha256Hex(stableSerialize(canonicalArtifactPayload(artifact)))}`;
}

export async function createPortableArtifact(scanResult, source) {
  const artifact = {
    format: PORTABLE_INTEGRITY_FORMAT,
    artifactVersion: PORTABLE_INTEGRITY_VERSION,
    source,
    scanResult,
  };
  return { ...artifact, artifactId: await createPortableArtifactId(artifact) };
}

async function createScanId(targetId, fromBlock, toBlock) {
  return `scan_${await sha256Hex(["8453", targetId, fromBlock, toBlock].join("\n"))}`;
}

function scanShape(scan) {
  return isRecord(scan)
    && typeof scan.scanId === "string"
    && typeof scan.targetId === "string"
    && isRecord(scan.range)
    && DECIMAL_PATTERN.test(scan.range.fromBlock ?? "")
    && DECIMAL_PATTERN.test(scan.range.toBlock ?? "")
    && ["complete", "partial", "failed"].includes(scan.status)
    && Array.isArray(scan.alerts)
    && Array.isArray(scan.evidence)
    && Array.isArray(scan.failures);
}

function receiptShape(receipt) {
  if (!isRecord(receipt)) return { ok: false, code: "malformed-receipt" };
  if (receipt.schemaVersion !== 1) return { ok: false, code: "unsupported-receipt-version" };
  if (typeof receipt.receiptId !== "string" || !RECEIPT_ID_PATTERN.test(receipt.receiptId)) {
    return { ok: false, code: "malformed-receipt" };
  }
  if (REQUIRED_RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))) {
    return { ok: false, code: "malformed-receipt" };
  }
  return { ok: true };
}

function profileFor(targetId) {
  return archiveProfiles.find(({ id }) => id === targetId) ?? null;
}

function projectedCheck(check) {
  if (!isRecord(check)) return check;
  const clone = structuredClone(check);
  delete clone.elapsedMs;
  if (clone.result?.kind === "bytecode") delete clone.result.hash;
  return clone;
}

function checkComparisons(expectedChecks, observedChecks) {
  const comparisons = [];
  if (!Array.isArray(observedChecks) || observedChecks.length !== expectedChecks.length) {
    comparisons.push(comparison("checks", expectedChecks, observedChecks, "check-results-mismatch"));
    return comparisons;
  }
  for (let index = 0; index < expectedChecks.length; index += 1) {
    const expected = projectedCheck(expectedChecks[index]);
    const observed = projectedCheck(observedChecks[index]);
    if (equal(expected, observed)) {
      comparisons.push(comparison(`checks[${index}]`, expected, observed));
      continue;
    }
    for (const field of ["id", "required", "method", "parameters", "blockTag", "assertion", "result", "status", "failure"]) {
      comparisons.push(comparison(`checks[${index}].${field}`, expected?.[field], observed?.[field], "check-results-mismatch"));
    }
  }
  const expectedIds = expectedChecks.map(({ id }) => id);
  const observedIds = observedChecks.map(({ id }) => id);
  if (!equal(expectedIds, observedIds)) comparisons.push(comparison("checks", expectedIds, observedIds, "check-order-mismatch"));
  return comparisons;
}

function failedComparisons(comparisons) {
  return comparisons.filter(({ status }) => status !== "matched");
}

function isContradictionDerivedPath(path) {
  return path === "event.decodedArguments.implementation"
    || path === "severity.result"
    || /^checks\[(1|2)\]\.(parameters|assertion|result|status|failure)$/.test(path);
}

function baseDetails(artifact, receipt, computedReceiptId, comparisons) {
  const paths = comparisonSet(comparisons);
  return {
    artifactId: artifact.artifactId,
    computedArtifactId: artifact.artifactId,
    receiptId: receipt?.receiptId ?? null,
    computedReceiptId,
    ...paths,
  };
}

export async function verifyPortableIntegrityArtifact(artifact) {
  if (!isRecord(artifact)) return malformed("The selected JSON value is not a portable integrity artifact.");
  if (artifact.format !== PORTABLE_INTEGRITY_FORMAT) return result("refused", null, "wrong-format");
  if (artifact.artifactVersion !== PORTABLE_INTEGRITY_VERSION) return result("refused", null, "unsupported-artifact-version");
  if (!ARTIFACT_ID_PATTERN.test(artifact.artifactId ?? "")) return malformed("The artifact ID is missing or malformed.");
  if (!isRecord(artifact.source) || !["live", "fixture"].includes(artifact.source.declared) || !["live-rpc", "verified-fixture"].includes(artifact.source.provenance)) {
    return malformed("The artifact source declaration is missing or malformed.");
  }

  let computedArtifactId;
  try {
    computedArtifactId = await createPortableArtifactId(artifact);
  } catch {
    return malformed("The portable artifact could not be canonically serialized.");
  }
  if (computedArtifactId !== artifact.artifactId) {
    return result("refused", null, "artifact-id-mismatch", {
      artifactId: artifact.artifactId,
      computedArtifactId,
    });
  }
  if (!scanShape(artifact.scanResult)) return malformed("The embedded scan result is malformed.");

  const scan = artifact.scanResult;
  const profile = profileFor(scan.targetId);
  const scanComparisons = [];
  if (!profile) {
    scanComparisons.push(comparison("target.profileId", archiveProfiles.map(({ id }) => id), scan.targetId, "target-profile-mismatch"));
  } else {
    scanComparisons.push(
      comparison("target.profileId", profile.id, scan.targetId, "target-profile-mismatch"),
      comparison("network.chainId", 8453, scan.evidence[0]?.network?.chainId, "chain-id-mismatch"),
      comparison("scan.range.fromBlock", profile.block.number, scan.range.fromBlock, "block-range-mismatch"),
      comparison("scan.range.toBlock", profile.block.number, scan.range.toBlock, "block-range-mismatch"),
    );
  }
  const expectedScanId = await createScanId(scan.targetId, scan.range.fromBlock, scan.range.toBlock);
  scanComparisons.push(comparison("scan.scanId", expectedScanId, scan.scanId, "scan-id-mismatch"));
  const sourceComparison = comparison("source.provenance", artifact.source.declared === "live" ? "live-rpc" : "verified-fixture", artifact.source.provenance, artifact.source.declared === "live" ? "fixture-presented-as-live" : "live-presented-as-fixture");
  scanComparisons.push(sourceComparison);
  if (!sourceConsistent(artifact.source)) {
    const paths = comparisonSet([sourceComparison]);
    return result("refused", "EVIDENCE_MISMATCH", sourceComparison.code, {
      artifactId: artifact.artifactId,
      computedArtifactId,
      ...paths,
    });
  }

  const failures = scan.failures;
  const rpcFailure = failures.find(({ category }) => RPC_CATEGORIES.has(category));
  if (scan.evidence.length === 0) {
    return result("verified", rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure ? `rpc-${rpcFailure.category}` : "missing-evidence", {
      ...baseDetails(artifact, null, null, scanComparisons),
    });
  }
  const evidence = scan.evidence[0];
  const receipt = evidence?.investigationReceipt;
  if (!receipt) {
    return result("verified", rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure ? `rpc-${rpcFailure.category}` : "missing-receipt", {
      ...baseDetails(artifact, null, null, scanComparisons),
    });
  }
  const receiptState = receiptShape(receipt);
  if (!receiptState.ok) {
    return result("verified", "INVALID_RECEIPT", receiptState.code, {
      artifactId: artifact.artifactId,
      computedArtifactId,
      receiptId: receipt.receiptId ?? null,
      failedPaths: ["receipt"],
    });
  }
  let computedReceiptId;
  try {
    computedReceiptId = await createReceiptId(receipt);
  } catch {
    return result("verified", "INVALID_RECEIPT", "malformed-receipt", {
      artifactId: artifact.artifactId,
      computedArtifactId,
      receiptId: receipt.receiptId,
      failedPaths: ["receipt"],
    });
  }
  if (computedReceiptId !== receipt.receiptId) {
    return result("verified", "INVALID_RECEIPT", "receipt-id-mismatch", {
      artifactId: artifact.artifactId,
      computedArtifactId,
      receiptId: receipt.receiptId,
      computedReceiptId,
      failedPaths: ["receipt.receiptId"],
    });
  }
  if (!profile) {
    return result("verified", "EVIDENCE_MISMATCH", "target-profile-mismatch", {
      ...baseDetails(artifact, receipt, computedReceiptId, scanComparisons),
    });
  }

  const trigger = receipt.trigger;
  const implementation = evidence.event?.decodedArguments?.implementation;
  const expectedSeverity = implementation?.toLowerCase() === profile.implementation.toLowerCase()
    ? "informational"
    : /^0x0{40}$/i.test(implementation ?? "")
      ? "high"
      : "suspicious";
  const evidenceComparisons = [
    ...scanComparisons,
    comparison("target.profileId", scan.targetId, trigger?.targetId, "target-profile-mismatch"),
    comparison("network.name", "base-mainnet", evidence.network?.name, "network-mismatch"),
    comparison("block.number", profile.block.number, evidence.block?.number, "block-number-mismatch"),
    comparison("block.hash", profile.block.hash, evidence.block?.hash, "block-hash-mismatch"),
    comparison("transaction.hash", profile.transaction.hash, evidence.transaction?.hash, "transaction-hash-mismatch"),
    comparison("event.emitter", profile.emitter, evidence.log?.emitter, "event-emitter-mismatch"),
    comparison("event.signature", "Upgraded(address)", evidence.event?.signature, "event-signature-mismatch"),
    comparison("event.decodedArguments.implementation", profile.implementation, implementation, "implementation-mismatch"),
    comparison("detector.id", profile.detectorId, evidence.detector?.id, "detector-mismatch"),
    comparison("severity.result", expectedSeverity, evidence.severity?.result, "severity-mismatch"),
    comparison("investigation.plan", profile.receipt.plan, evidence.upgradeInvestigation?.plan, "plan-out-of-scope"),
    comparison("investigation.disposition", evidence.upgradeInvestigation?.disposition, receipt.finalDisposition, "disposition-mismatch"),
    comparison("receipt.trigger.block.hash", evidence.block?.hash, trigger?.block?.hash, "block-hash-mismatch"),
    comparison("receipt.trigger.transaction.hash", evidence.transaction?.hash, trigger?.transaction?.hash, "transaction-hash-mismatch"),
    comparison("receipt.trigger.event.emitter", evidence.log?.emitter, trigger?.log?.emitter, "event-emitter-mismatch"),
    comparison("receipt.trigger.event.signature", evidence.event?.signature, trigger?.eventSignature, "event-signature-mismatch"),
    comparison("receipt.trigger.implementation", implementation, trigger?.decodedArguments?.implementation, "implementation-mismatch"),
    comparison("receipt.plan", evidence.upgradeInvestigation?.plan, receipt.plan, "plan-mismatch"),
    comparison("receipt.checks", evidence.upgradeInvestigation?.checks, receipt.checks, "check-results-mismatch"),
    comparison("receipt.explorerLinks", evidence.sources, receipt.explorerLinks, "explorer-links-mismatch"),
    comparison("receipt.finalDisposition", evidence.upgradeInvestigation?.disposition, receipt.finalDisposition, "disposition-mismatch"),
    ...checkComparisons(profile.checks, evidence.upgradeInvestigation?.checks),
  ];
  const failed = failedComparisons(evidenceComparisons);
  const disposition = evidence.upgradeInvestigation?.disposition;
  const structuralFailure = failed.some(({ path }) => !isContradictionDerivedPath(path)
    && !path.startsWith("receipt.trigger.implementation")
    && path !== "receipt.checks"
    && path !== "receipt.finalDisposition");
  const contradiction = disposition === "contradicted"
    && failed.length > 0
    && !structuralFailure
    && failed.some(({ path }) => isContradictionDerivedPath(path));
  const details = baseDetails(artifact, receipt, computedReceiptId, evidenceComparisons);
  if (structuralFailure || (!contradiction && failed.length > 0)) {
    return result("verified", "EVIDENCE_MISMATCH", "evidence-mismatch", details);
  }
  const incomplete = scan.status !== "complete"
    || failures.length > 0
    || evidence.status !== "complete"
    || evidence.upgradeInvestigation?.evidenceStatus !== "complete"
    || disposition === "incomplete"
    || evidence.upgradeInvestigation?.checks?.some(({ status }) => status === "failed" || status === "unsupported");
  if (incomplete) {
    return result("verified", rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure ? `rpc-${rpcFailure.category}` : "incomplete-evidence", details);
  }
  if (contradiction) return result("verified", "CONTRADICTED", null, details);
  return result("verified", artifact.source.declared === "fixture" ? "FIXTURE_ONLY" : "CORROBORATED", null, details);
}

export async function verifyPortableIntegrityText(text) {
  if (typeof text !== "string" || text.trim().length === 0) return malformed("The selected file is empty or does not contain JSON.");
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch {
    return malformed("The selected file is not valid JSON.");
  }
  return verifyPortableIntegrityArtifact(artifact);
}
