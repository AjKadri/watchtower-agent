import { z } from "zod";

import {
  investigationReceiptSchema,
  scanResultSchema,
  type Evidence,
  type InvestigationReceipt,
  type ScanResult,
  type UpgradeInvestigationCheck,
} from "../domain/schemas.js";
import { evmAwareEqual, sameEvmAddress } from "../evm/address.js";
import { createReceiptId } from "../pipeline/ids.js";
import {
  getTargetProfile,
  planForProfile,
  type ProfileInvestigationCheck,
  type TargetProfile,
} from "../profiles/registry.js";

export const evidenceIntegrityOutcomeSchema = z.enum([
  "CORROBORATED",
  "CONTRADICTED",
  "INCOMPLETE",
  "EVIDENCE_MISMATCH",
  "RPC_UNAVAILABLE",
  "FIXTURE_ONLY",
  "INVALID_RECEIPT",
]);

export const evidenceIntegritySourceSchema = z.enum(["live", "fixture"]);
export const evidenceIntegrityProvenanceSchema = z.enum(["live-rpc", "verified-fixture"]);
export const evidenceIntegrityComparisonStatusSchema = z.enum(["matched", "mismatch", "unavailable"]);

const jsonValueSchema: z.ZodType<unknown> = z.unknown();

export const evidenceIntegrityComparisonSchema = z.object({
  path: z.string().min(1),
  expected: jsonValueSchema,
  observed: jsonValueSchema,
  status: evidenceIntegrityComparisonStatusSchema,
  code: z.string().min(1).nullable(),
}).strict();

export const evidenceIntegrityResultSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: evidenceIntegrityOutcomeSchema,
  message: z.string().min(1),
  refusalCode: z.string().min(1).nullable(),
  scan: z.object({
    scanId: z.string().min(1).nullable(),
    targetId: z.string().min(1).nullable(),
    status: z.enum(["complete", "partial", "failed"]).nullable(),
  }).strict(),
  source: z.object({
    declared: evidenceIntegritySourceSchema,
    provenance: evidenceIntegrityProvenanceSchema,
    consistent: z.boolean(),
  }).strict(),
  receipt: z.object({
    present: z.boolean(),
    verified: z.boolean(),
    receiptId: z.string().nullable(),
    expectedReceiptId: z.string().nullable(),
  }).strict(),
  expected: z.record(z.string(), jsonValueSchema),
  observed: z.record(z.string(), jsonValueSchema),
  comparisons: z.array(evidenceIntegrityComparisonSchema),
  matchedPaths: z.array(z.string()),
  failedPaths: z.array(z.string()),
}).strict();

export type EvidenceIntegrityOutcome = z.infer<typeof evidenceIntegrityOutcomeSchema>;
export type EvidenceIntegritySource = z.infer<typeof evidenceIntegritySourceSchema>;
export type EvidenceIntegrityProvenance = z.infer<typeof evidenceIntegrityProvenanceSchema>;
export type EvidenceIntegrityComparison = z.infer<typeof evidenceIntegrityComparisonSchema>;
export type EvidenceIntegrityResult = z.infer<typeof evidenceIntegrityResultSchema>;

export type EvidenceIntegrityInput = {
  result: unknown;
  source: EvidenceIntegritySource;
  provenance: EvidenceIntegrityProvenance;
};

type ScanSnapshot = {
  scanId: string | null;
  targetId: string | null;
  status: ScanResult["status"] | null;
};

type ReceiptState = {
  present: boolean;
  verified: boolean;
  receiptId: string | null;
  expectedReceiptId: string | null;
};

const RPC_UNAVAILABLE_CATEGORIES = new Set(["dns", "timeout", "rate-limit", "unavailable"]);

function snapshotOf(value: unknown): ScanSnapshot {
  if (!value || typeof value !== "object") return { scanId: null, targetId: null, status: null };
  const record = value as Record<string, unknown>;
  return {
    scanId: typeof record.scanId === "string" ? record.scanId : null,
    targetId: typeof record.targetId === "string" ? record.targetId : null,
    status: record.status === "complete" || record.status === "partial" || record.status === "failed" ? record.status : null,
  };
}

function emptyReceiptState(value: unknown): ReceiptState {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const rawEvidence = record && Array.isArray(record.evidence) ? record.evidence[0] : null;
  const rawReceipt = rawEvidence && typeof rawEvidence === "object"
    ? (rawEvidence as Record<string, unknown>).investigationReceipt
    : null;
  return {
    present: Boolean(rawReceipt),
    verified: false,
    receiptId: rawReceipt && typeof rawReceipt === "object" && typeof (rawReceipt as Record<string, unknown>).receiptId === "string"
      ? (rawReceipt as Record<string, unknown>).receiptId as string
      : null,
    expectedReceiptId: null,
  };
}

function comparison(
  path: string,
  expected: unknown,
  observed: unknown,
  code: string | null = null,
): EvidenceIntegrityComparison {
  const status = observed === null || observed === undefined
    ? "unavailable"
    : evmAwareEqual(expected, observed)
      ? "matched"
      : "mismatch";
  return evidenceIntegrityComparisonSchema.parse({ path, expected, observed: observed ?? null, status, code: status === "matched" ? null : code });
}

function sourceComparison(source: EvidenceIntegrityInput): EvidenceIntegrityComparison {
  const expected = source.source === "live" ? "live-rpc" : "verified-fixture";
  return comparison(
    "source.provenance",
    expected,
    source.provenance,
    source.source === "live" ? "fixture-presented-as-live" : "live-presented-as-fixture",
  );
}

function failureCategory(result: ScanResult): string | null {
  return result.failures.find(({ category }) => category && RPC_UNAVAILABLE_CATEGORIES.has(category))?.category ?? null;
}

function profileForEvidence(result: ScanResult, _evidence: Evidence): TargetProfile {
  return getTargetProfile(result.targetId);
}

function expectedCheckStatus(
  definition: ProfileInvestigationCheck,
  check: UpgradeInvestigationCheck,
  implementation: string,
): "passed" | "mismatch" | "failed" | "unsupported" {
  if (check.result === null) return check.status === "unsupported" ? "unsupported" : "failed";
  if (definition.kind === "storage-address") {
    return check.result.kind === "address"
      && sameEvmAddress(check.result.value, definition.expectedAddress)
      && (!definition.mustMatchDecodedImplementation || sameEvmAddress(check.result.value, implementation))
      ? "passed"
      : "mismatch";
  }
  if (definition.kind === "implementation-code") {
    return check.result.kind === "bytecode"
      && check.result.present
      && check.result.byteLength === definition.expectedByteLength
      && sameEvmAddress(implementation, definition.expectedApprovedImplementation)
      ? "passed"
      : "mismatch";
  }
  if (definition.kind === "call-address") {
    return check.result.kind === "address" && sameEvmAddress(check.result.value, definition.expectedAddress)
      ? "passed"
      : "mismatch";
  }
  return check.result.kind === "uint256" && check.result.value === definition.expectedValue
    ? "passed"
    : "mismatch";
}

function observedCheckResult(check: UpgradeInvestigationCheck): unknown {
  if (check.result === null) return null;
  return check.result.kind === "bytecode"
    ? { present: check.result.present, byteLength: check.result.byteLength }
    : check.result.value;
}

function expectedCheckResult(definition: ProfileInvestigationCheck): unknown {
  if (definition.kind === "implementation-code") return { present: true, byteLength: definition.expectedByteLength };
  if (definition.kind === "call-uint256") return definition.expectedValue;
  return definition.expectedAddress;
}

function expectedCheckParameters(definition: ProfileInvestigationCheck, implementation: string): Record<string, string> {
  if (definition.kind === "storage-address") return { address: definition.address, slot: definition.slot };
  if (definition.kind === "implementation-code") return { address: implementation };
  return { to: definition.to, data: definition.data };
}

function expectedCheckAssertion(definition: ProfileInvestigationCheck): string {
  if (definition.kind === "implementation-code") return `${definition.expectedByteLength} bytes`;
  if (definition.kind === "call-uint256") return definition.expectedValue;
  return definition.expectedAddress;
}

function receiptMatchesEvidence(evidence: Evidence, receipt: InvestigationReceipt): EvidenceIntegrityComparison[] {
  const trigger = receipt.trigger;
  const comparisons = [
    comparison("block.hash", evidence.block.hash, trigger.block.hash, "block-hash-mismatch"),
    comparison("transaction.hash", evidence.transaction.hash, trigger.transaction.hash, "transaction-hash-mismatch"),
    comparison("event.emitter", evidence.log.emitter, trigger.log.emitter, "event-emitter-mismatch"),
    comparison("event.signature", evidence.event.signature, trigger.eventSignature, "event-signature-mismatch"),
    comparison("event.decodedArguments.implementation", evidence.event.decodedArguments.implementation, trigger.decodedArguments.implementation, "implementation-mismatch"),
    comparison("plan", evidence.upgradeInvestigation.plan, receipt.plan, "plan-mismatch"),
    comparison("checks", evidence.upgradeInvestigation.checks, receipt.checks, "check-results-mismatch"),
    comparison("finalDisposition", evidence.upgradeInvestigation.disposition, receipt.finalDisposition, "disposition-mismatch"),
  ];
  return comparisons;
}

function baseResult(
  input: EvidenceIntegrityInput,
  snapshot: ScanSnapshot,
  outcome: EvidenceIntegrityOutcome,
  message: string,
  refusalCode: string | null,
  receipt: ReceiptState,
  expected: Record<string, unknown> = {},
  observed: Record<string, unknown> = {},
  comparisons: EvidenceIntegrityComparison[] = [],
): EvidenceIntegrityResult {
  const source = {
    declared: input.source,
    provenance: input.provenance,
    consistent: (input.source === "live" && input.provenance === "live-rpc")
      || (input.source === "fixture" && input.provenance === "verified-fixture"),
  };
  const matchedPaths = comparisons.filter(({ status }) => status === "matched").map(({ path }) => path);
  const failedPaths = comparisons.filter(({ status }) => status !== "matched").map(({ path }) => path);
  return evidenceIntegrityResultSchema.parse({
    schemaVersion: 1,
    outcome,
    message,
    refusalCode,
    scan: snapshot,
    source,
    receipt,
    expected,
    observed,
    comparisons,
    matchedPaths,
    failedPaths,
  });
}

function invalidReceiptResult(
  input: EvidenceIntegrityInput,
  snapshot: ScanSnapshot,
  value: unknown,
  receiptState: ReceiptState,
  code = "invalid-receipt",
): EvidenceIntegrityResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const evidence = record && Array.isArray(record.evidence) ? record.evidence[0] : null;
  const rawReceipt = evidence && typeof evidence === "object"
    ? (evidence as Record<string, unknown>).investigationReceipt
    : null;
  const expectedReceiptId = rawReceipt && typeof rawReceipt === "object"
    ? (() => {
      try {
        return createReceiptId(rawReceipt as InvestigationReceipt);
      } catch {
        return null;
      }
    })()
    : null;
  const receipt = { ...receiptState, expectedReceiptId };
  const receiptIdComparison = comparison("receipt.receiptId", expectedReceiptId, receiptState.receiptId, code);
  return baseResult(
    input,
    snapshot,
    "INVALID_RECEIPT",
    "The receipt is present but cannot be verified against receipt schema v1 and its canonical ID.",
    code,
    receipt,
    { receiptSchema: 1 },
    { receipt: rawReceipt ?? null },
    [sourceComparison(input), receiptIdComparison],
  );
}

function incompleteResult(
  input: EvidenceIntegrityInput,
  snapshot: ScanSnapshot,
  receipt: ReceiptState,
  message: string,
  refusalCode: string,
): EvidenceIntegrityResult {
  return baseResult(input, snapshot, "INCOMPLETE", message, refusalCode, receipt, {}, {}, [sourceComparison(input)]);
}

function rawEvidenceMismatchComparisons(value: unknown): EvidenceIntegrityComparison[] {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const evidenceValue = record && Array.isArray(record.evidence) ? record.evidence[0] : null;
  const evidence = evidenceValue && typeof evidenceValue === "object" ? evidenceValue as Record<string, unknown> : null;
  const receiptValue = evidence?.investigationReceipt;
  const receipt = receiptValue && typeof receiptValue === "object" ? receiptValue as Record<string, unknown> : null;
  const trigger = receipt?.trigger && typeof receipt.trigger === "object" ? receipt.trigger as Record<string, unknown> : null;
  const mismatches: EvidenceIntegrityComparison[] = [];
  const add = (path: string, expected: unknown, observed: unknown, code = "evidence-mismatch") => {
    const comparisonResult = comparison(path, expected, observed, code);
    if (comparisonResult.status === "mismatch") mismatches.push(comparisonResult);
  };
  if (!evidence || !receipt || !trigger) return mismatches;
  const evidenceBlock = evidence.block && typeof evidence.block === "object" ? evidence.block as Record<string, unknown> : null;
  const triggerBlock = trigger.block && typeof trigger.block === "object" ? trigger.block as Record<string, unknown> : null;
  const evidenceTransaction = evidence.transaction && typeof evidence.transaction === "object" ? evidence.transaction as Record<string, unknown> : null;
  const triggerTransaction = trigger.transaction && typeof trigger.transaction === "object" ? trigger.transaction as Record<string, unknown> : null;
  const evidenceLog = evidence.log && typeof evidence.log === "object" ? evidence.log as Record<string, unknown> : null;
  const triggerLog = trigger.log && typeof trigger.log === "object" ? trigger.log as Record<string, unknown> : null;
  const evidenceEvent = evidence.event && typeof evidence.event === "object" ? evidence.event as Record<string, unknown> : null;
  const evidenceDecoded = evidenceEvent?.decodedArguments && typeof evidenceEvent.decodedArguments === "object"
    ? evidenceEvent.decodedArguments as Record<string, unknown>
    : null;
  const triggerDecoded = trigger.decodedArguments && typeof trigger.decodedArguments === "object"
    ? trigger.decodedArguments as Record<string, unknown>
    : null;
  const detector = trigger.detector && typeof trigger.detector === "object" ? trigger.detector as Record<string, unknown> : null;
  const evidencePlan = evidence.upgradeInvestigation && typeof evidence.upgradeInvestigation === "object"
    ? evidence.upgradeInvestigation as Record<string, unknown>
    : null;
  const receiptChecks = Array.isArray(receipt.checks) ? receipt.checks : [];
  const evidenceChecks = Array.isArray(evidencePlan?.checks) ? evidencePlan.checks : [];

  add("block.number", triggerBlock?.number, evidenceBlock?.number, "block-number-mismatch");
  add("block.hash", triggerBlock?.hash, evidenceBlock?.hash, "block-hash-mismatch");
  add("transaction.hash", triggerTransaction?.hash, evidenceTransaction?.hash, "transaction-hash-mismatch");
  add("event.emitter", triggerLog?.emitter, evidenceLog?.emitter, "event-emitter-mismatch");
  add("event.signature", trigger.eventSignature, evidenceEvent?.signature, "event-signature-mismatch");
  add("event.decodedArguments.implementation", triggerDecoded?.implementation, evidenceDecoded?.implementation, "implementation-mismatch");
  add("severity.result", detector?.severity, (evidence.severity as Record<string, unknown> | undefined)?.result, "severity-mismatch");
  add("plan", receipt.plan, evidencePlan?.plan, "plan-mismatch");
  add("finalDisposition", receipt.finalDisposition, evidencePlan?.disposition, "disposition-mismatch");
  for (let index = 0; index < Math.max(evidenceChecks.length, receiptChecks.length); index += 1) {
    const evidenceCheck = evidenceChecks[index];
    const receiptCheck = receiptChecks[index];
    if (!evmAwareEqual(evidenceCheck, receiptCheck)) {
      const evidenceRecord = evidenceCheck && typeof evidenceCheck === "object" ? evidenceCheck as Record<string, unknown> : null;
      const receiptRecord = receiptCheck && typeof receiptCheck === "object" ? receiptCheck as Record<string, unknown> : null;
      for (const field of ["id", "result", "status", "assertion", "method", "parameters", "blockTag", "failure"]) {
        add(`checks[${index}].${field}`, receiptRecord?.[field], evidenceRecord?.[field], "check-results-mismatch");
      }
      if (!mismatches.some(({ path }) => path.startsWith(`checks[${index}].`))) {
        mismatches.push(comparison(`checks[${index}]`, receiptCheck, evidenceCheck, "check-results-mismatch"));
      }
    }
  }
  return mismatches;
}

function evidenceMismatchFromParse(
  input: EvidenceIntegrityInput,
  snapshot: ScanSnapshot,
  receiptState: ReceiptState,
  comparisons: EvidenceIntegrityComparison[],
): EvidenceIntegrityResult {
  return baseResult(
    input,
    snapshot,
    "EVIDENCE_MISMATCH",
    "The evidence record and its receipt no longer describe the same observation.",
    "evidence-mismatch",
    receiptState,
    {},
    { issuePaths: comparisons.map(({ path }) => path) },
    comparisons,
  );
}

/**
 * Evaluate a structured scan result without changing the scanner or receipt.
 * `provenance` is supplied by the trusted caller: the API endpoint uses live-rpc,
 * while committed browser fixtures use verified-fixture. A mismatch refuses to
 * corroborate rather than guessing which source was used.
 */
export function evaluateEvidenceIntegrity(input: EvidenceIntegrityInput): EvidenceIntegrityResult {
  const snapshot = snapshotOf(input.result);
  const initialReceipt = emptyReceiptState(input.result);
  const sourceCheck = sourceComparison(input);
  if (sourceCheck.status !== "matched") {
    return baseResult(
      input,
      snapshot,
      "EVIDENCE_MISMATCH",
      "The declared source does not match the trusted provenance label.",
      sourceCheck.code,
      initialReceipt,
      { source: input.source === "live" ? "live-rpc" : "verified-fixture" },
      { source: input.provenance },
      [sourceCheck],
    );
  }

  const parsedResult = scanResultSchema.safeParse(input.result);
  if (!parsedResult.success) {
    if (initialReceipt.present) {
      const rawEvidence = (input.result as Record<string, unknown>).evidence;
      const rawFirstEvidence = Array.isArray(rawEvidence) ? rawEvidence[0] : null;
      const rawReceipt = rawFirstEvidence && typeof rawFirstEvidence === "object"
        ? (rawFirstEvidence as Record<string, unknown>).investigationReceipt
        : null;
      const receiptParse = investigationReceiptSchema.safeParse(rawReceipt);
      if (receiptParse.success) {
        const rawComparisons = rawEvidenceMismatchComparisons(input.result);
        const rawPaths = new Set(rawComparisons.map(({ path }) => path));
        const issueComparisons = parsedResult.error.issues
          .map(({ path }) => path.join("."))
          .filter((path) => path && !rawPaths.has(path))
          .map((path) => comparison(path, "recorded evidence", "changed", "evidence-mismatch"));
        return evidenceMismatchFromParse(
          input,
          snapshot,
          initialReceipt,
          [...rawComparisons, ...issueComparisons],
        );
      }
      return invalidReceiptResult(input, snapshot, input.result, initialReceipt, "malformed-receipt-or-evidence");
    }
    return incompleteResult(input, snapshot, initialReceipt, "The scan result is malformed and cannot support an integrity conclusion.", "malformed-evidence");
  }

  const result = parsedResult.data;
  const rpcFailure = failureCategory(result);
  if (result.evidence.length === 0) {
    return baseResult(
      input,
      snapshot,
      rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE",
      rpcFailure ? "The approved evidence could not be retrieved from the configured RPC." : "No qualifying evidence record is available for integrity checks.",
      rpcFailure ? `rpc-${rpcFailure}` : "missing-evidence",
      initialReceipt,
      {},
      { evidenceCount: result.evidence.length },
      [sourceCheck],
    );
  }
  const evidence = result.evidence[0];
  const profile = profileForEvidence(result, evidence);
  const receiptValue = evidence.investigationReceipt;
  if (!receiptValue) {
    return result.status === "failed" || rpcFailure
      ? baseResult(input, snapshot, "RPC_UNAVAILABLE", "The scan could not produce a receipt because the required RPC evidence was unavailable.", `rpc-${rpcFailure ?? "unavailable"}`, initialReceipt, {}, { evidenceStatus: evidence.status }, [sourceCheck])
      : incompleteResult(input, snapshot, initialReceipt, "The evidence is incomplete and no receipt was issued.", "missing-receipt");
  }

  const parsedReceipt = investigationReceiptSchema.safeParse(receiptValue);
  if (!parsedReceipt.success) return invalidReceiptResult(input, snapshot, input.result, initialReceipt);
  const receipt = parsedReceipt.data;
  const expectedReceiptId = createReceiptId(receipt);
  const receiptState: ReceiptState = {
    present: true,
    verified: receipt.receiptId === expectedReceiptId,
    receiptId: receipt.receiptId,
    expectedReceiptId,
  };
  if (!receiptState.verified) return invalidReceiptResult(input, snapshot, input.result, receiptState, "receipt-id-mismatch");

  const registeredPlan = planForProfile(profile, evidence.upgradeInvestigation.plan.id);
  const implementation = evidence.event.decodedArguments.implementation;
  const detector = profile.detectors[0];
  const expectedSeverity = implementation.toLowerCase() === profile.severityPolicy.approvedTargetAddresses[0].toLowerCase()
    ? "informational"
    : /^0x0{40}$/i.test(implementation)
      ? "high"
      : "suspicious";
  const comparisons: EvidenceIntegrityComparison[] = [
    sourceCheck,
    comparison("target.profileId", profile.profileId, result.targetId, "target-profile-mismatch"),
    comparison("network.name", profile.network.name, evidence.network.name, "network-mismatch"),
    comparison("network.chainId", profile.network.chainId, evidence.network.chainId, "chain-id-mismatch"),
    comparison("block.number", profile.scan.toBlock, evidence.block.number, "block-number-mismatch"),
    comparison("block.hash", evidence.block.hash, receipt.trigger.block.hash, "block-hash-mismatch"),
    comparison("transaction.hash", profile.scan.knownTransactions[0], evidence.transaction.hash, "transaction-hash-mismatch"),
    comparison("transaction.hash.receipt", evidence.transaction.hash, receipt.trigger.transaction.hash, "transaction-hash-mismatch"),
    comparison("event.emitter", profile.target.primaryContract.address, evidence.log.emitter, "event-emitter-mismatch"),
    comparison("event.signature", detector.eventSignature, evidence.event.signature, "event-signature-mismatch"),
    comparison("event.decodedArguments.implementation", profile.expectedFixture.implementationAfter, implementation, "implementation-mismatch"),
    comparison("investigation.plan", registeredPlan, evidence.upgradeInvestigation.plan, "plan-out-of-scope"),
    comparison("investigation.plan.selectedChecks", registeredPlan.selectedChecks, evidence.upgradeInvestigation.plan.selectedChecks, "plan-checks-out-of-scope"),
    comparison("investigation.checks.executed", registeredPlan.selectedChecks, evidence.upgradeInvestigation.checks.map(({ id }) => id), "executed-checks-out-of-scope"),
    comparison("severity.result", expectedSeverity, evidence.severity.result, "severity-mismatch"),
    ...receiptMatchesEvidence(evidence, receipt),
  ];

  const definitions = new Map(profile.investigation.checks.map((definition) => [definition.id, definition]));
  for (const [index, check] of evidence.upgradeInvestigation.checks.entries()) {
    const definition = definitions.get(check.id);
    if (!definition) {
      comparisons.push(comparison(`checks[${index}].id`, profile.investigation.checks.map(({ id }) => id), check.id, "check-out-of-scope"));
      continue;
    }
    comparisons.push(
      comparison(`checks[${index}].method`, definition.method, check.method, "check-method-mismatch"),
      comparison(`checks[${index}].blockTag`, definition.block === "previous"
        ? `0x${BigInt(profile.investigation.previousBlock).toString(16)}`
        : `0x${BigInt(profile.investigation.upgradeBlock).toString(16)}`, check.blockTag, "check-block-mismatch"),
      comparison(`checks[${index}].parameters`, expectedCheckParameters(definition, implementation), check.parameters, "check-parameters-mismatch"),
      comparison(`checks[${index}].assertion.expected`, expectedCheckAssertion(definition), check.assertion.expected, "check-assertion-mismatch"),
      comparison(`checks[${index}].result`, expectedCheckResult(definition), observedCheckResult(check), "check-result-mismatch"),
      comparison(`checks[${index}].status`, expectedCheckStatus(definition, check, implementation), check.status, "check-status-mismatch"),
    );
  }

  const failedComparisons = comparisons.filter(({ status }) => status === "mismatch");
  const disposition = evidence.upgradeInvestigation.disposition;
  const implementationMismatch = failedComparisons.some(({ code }) => code === "implementation-mismatch");
  const checkResultMismatch = failedComparisons.some(({ code }) => code === "check-result-mismatch");
  const structuralMismatch = failedComparisons.some(({ code }) => code && [
    "target-profile-mismatch",
    "network-mismatch",
    "chain-id-mismatch",
    "block-number-mismatch",
    "block-hash-mismatch",
    "transaction-hash-mismatch",
    "event-emitter-mismatch",
    "event-signature-mismatch",
    "plan-out-of-scope",
    "plan-checks-out-of-scope",
    "executed-checks-out-of-scope",
    "check-out-of-scope",
    "check-method-mismatch",
    "check-block-mismatch",
    "check-parameters-mismatch",
    "check-assertion-mismatch",
    "check-results-mismatch",
    "disposition-mismatch",
    "receipt-id-mismatch",
  ].includes(code));
  const derivedMismatch = failedComparisons.some(({ code }) => code === "severity-mismatch")
    || (implementationMismatch && disposition !== "contradicted")
    || (checkResultMismatch && disposition !== "contradicted");
  if (structuralMismatch || derivedMismatch) {
    return baseResult(input, snapshot, "EVIDENCE_MISMATCH", "One or more expected evidence fields no longer match the observed scan or receipt.", "evidence-mismatch", receiptState, {
      profileId: profile.profileId,
      chainId: profile.network.chainId,
      blockNumber: profile.scan.toBlock,
      transactionHash: profile.scan.knownTransactions[0],
      eventSignature: detector.eventSignature,
      implementation: profile.expectedFixture.implementationAfter,
      plan: registeredPlan,
    }, {
      profileId: result.targetId,
      chainId: evidence.network.chainId,
      blockNumber: evidence.block.number,
      blockHash: evidence.block.hash,
      transactionHash: evidence.transaction.hash,
      eventSignature: evidence.event.signature,
      implementation,
      plan: evidence.upgradeInvestigation.plan,
      checks: evidence.upgradeInvestigation.checks,
      severity: evidence.severity.result,
    }, comparisons);
  }

  const incomplete = result.status !== "complete"
    || result.failures.length > 0
    || evidence.status !== "complete"
    || evidence.upgradeInvestigation.evidenceStatus !== "complete"
    || evidence.upgradeInvestigation.disposition === "incomplete"
    || evidence.upgradeInvestigation.checks.some(({ status }) => status === "failed" || status === "unsupported");
  if (incomplete) {
    return baseResult(input, snapshot, rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure
      ? "The integrity result is unavailable because a required RPC read failed."
      : "The evidence path is incomplete and cannot corroborate the configured claim.", rpcFailure ? `rpc-${rpcFailure}` : "incomplete-evidence", receiptState, {
      profileId: profile.profileId,
      plan: registeredPlan,
    }, {
      profileId: result.targetId,
      status: evidence.status,
      checks: evidence.upgradeInvestigation.checks,
    }, comparisons);
  }

  const outcome: EvidenceIntegrityOutcome = evidence.upgradeInvestigation.disposition === "contradicted"
    ? "CONTRADICTED"
    : input.source === "fixture"
      ? "FIXTURE_ONLY"
      : "CORROBORATED";
  return baseResult(input, snapshot, outcome, outcome === "CORROBORATED"
    ? "The configured trigger, fixed checks, deterministic disposition, and canonical receipt agree."
    : outcome === "FIXTURE_ONLY"
      ? "The committed fixture is internally verified, but it is not a live RPC corroboration."
      : "The evidence is structurally valid but the deterministic checks contradict the approved profile assertion.", null, receiptState, {
    profileId: profile.profileId,
    network: profile.network,
    blockNumber: profile.scan.toBlock,
    transactionHash: profile.scan.knownTransactions[0],
    eventSignature: detector.eventSignature,
    implementation: profile.expectedFixture.implementationAfter,
    plan: registeredPlan,
  }, {
    profileId: result.targetId,
    network: evidence.network,
    block: evidence.block,
    transaction: evidence.transaction,
    event: evidence.event,
    plan: evidence.upgradeInvestigation.plan,
    checks: evidence.upgradeInvestigation.checks,
    severity: evidence.severity,
  }, comparisons);
}

export const verifyEvidenceIntegrity = evaluateEvidenceIntegrity;
