import { z } from "zod";
import { toHex } from "viem";

import { investigationCheckIdSchema, investigationPlanSchema } from "../investigation/plans.js";
import { createReceiptId } from "../pipeline/ids.js";
import { EVM_ADDRESS_PATTERN, evmAwareEqual, evmAwareStringEqual, normalizeEvmAddress, sameEvmAddress } from "../evm/address.js";
import { getTargetProfile, planForProfile, targetProfileIdSchema, type ProfileInvestigationCheck } from "../profiles/registry.js";

const address = z.string().regex(EVM_ADDRESS_PATTERN).transform(normalizeEvmAddress);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const blockTag = z.string().regex(/^0x[0-9a-f]+$/);
const sourceLinks = z.object({
  transaction: z.url(),
  block: z.url(),
  addresses: z.record(z.string(), z.url()),
}).strict();

export const investigationSchema = z.object({
  observedFacts: z.array(z.string().min(1)).min(1),
  interpretation: z.object({
    severityRuleId: z.string().min(1),
    text: z.string().min(1),
  }),
  limitations: z.array(z.string().min(1)).min(1),
});

const rpcFailureCategory = z.enum(["dns", "timeout", "rate-limit", "malformed-response", "unsupported", "unavailable"]);

export const upgradeInvestigationCheckSchema = z.object({
  id: investigationCheckIdSchema,
  required: z.boolean(),
  method: z.enum(["eth_getStorageAt", "eth_getCode", "eth_call"]),
  parameters: z.record(z.string(), z.string().min(1)),
  blockTag,
  result: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("address"), value: address }).strict(),
    z.object({ kind: z.literal("bytecode"), present: z.boolean(), byteLength: decimalString, hash: hash.nullable() }).strict(),
    z.object({ kind: z.literal("uint256"), value: decimalString }).strict(),
  ]).nullable(),
  assertion: z.object({
    description: z.string().min(1),
    expected: z.string().min(1),
    actual: z.string().min(1).nullable(),
    matches: z.boolean().nullable(),
  }).strict(),
  status: z.enum(["passed", "mismatch", "failed", "unsupported"]),
  failure: z.object({
    code: z.string().min(1),
    category: rpcFailureCategory,
    message: z.string().min(1),
  }).strict().nullable(),
  elapsedMs: z.number().int().nonnegative().optional(),
}).strict();

export const upgradeInvestigationSchema = z.object({
  plan: investigationPlanSchema,
  disposition: z.enum(["corroborated", "contradicted", "incomplete"]),
  evidenceStatus: z.enum(["complete", "incomplete"]),
  checks: z.array(upgradeInvestigationCheckSchema).max(6),
}).strict();

export const investigationReceiptTriggerSchema = z.object({
    network: z.object({ name: z.literal("base-mainnet"), chainId: z.literal(8453) }).strict(),
    targetId: targetProfileIdSchema,
    incidentClass: z.literal("contract_upgrade"),
    eventType: z.literal("proxy_upgraded"),
    eventSignature: z.literal("Upgraded(address)"),
    decodedArguments: z.object({ implementation: address }).strict(),
    block: z.object({ number: decimalString, hash, timestamp: z.iso.datetime() }).strict(),
    transaction: z.object({
      hash,
      sender: address,
      recipient: address.nullable(),
      receiptStatus: z.enum(["success", "reverted"]),
    }).strict(),
    log: z.object({
      index: decimalString,
      emitter: address,
      topic0: hash,
      rawTopics: z.array(hash).min(1),
    }).strict(),
    detector: z.object({ id: z.string().min(1), severityRuleId: z.string().min(1), severity: z.enum(["high", "suspicious", "informational"]) }).strict(),
}).strict().superRefine((trigger, context) => {
  const profile = getTargetProfile(trigger.targetId);
  const detector = profile.detectors[0];
  if (trigger.block.number !== profile.scan.toBlock) {
    context.addIssue({ code: "custom", path: ["block", "number"], message: "receipt block is outside the selected profile" });
  }
  if (trigger.transaction.hash.toLowerCase() !== profile.scan.knownTransactions[0].toLowerCase()) {
    context.addIssue({ code: "custom", path: ["transaction", "hash"], message: "receipt transaction is not the profile qualifying transaction" });
  }
  if (!sameEvmAddress(trigger.log.emitter, profile.target.primaryContract.address)) {
    context.addIssue({ code: "custom", path: ["log", "emitter"], message: "receipt emitter is not the profile primary proxy" });
  }
  if (trigger.log.topic0.toLowerCase() !== detector.topic0.toLowerCase() || trigger.log.rawTopics[0]?.toLowerCase() !== detector.topic0.toLowerCase()) {
    context.addIssue({ code: "custom", path: ["log", "topic0"], message: "receipt topic is not approved for the selected profile" });
  }
  if (trigger.detector.id !== detector.id || trigger.eventSignature !== detector.eventSignature) {
    context.addIssue({ code: "custom", path: ["detector"], message: "receipt detector is not registered for the selected profile" });
  }
});

export const investigationReceiptSchema = z.object({
  receiptId: z.string().regex(/^receipt_[0-9a-f]{64}$/),
  schemaVersion: z.literal(1),
  trigger: investigationReceiptTriggerSchema,
  plan: investigationPlanSchema,
  checks: z.array(upgradeInvestigationCheckSchema).max(6),
  errors: z.array(z.object({
    code: z.string().min(1),
    category: rpcFailureCategory,
    message: z.string().min(1),
  }).strict()),
  limitations: z.array(z.string().min(1)).min(1),
  finalDisposition: z.enum(["corroborated", "contradicted", "incomplete"]),
  explorerLinks: sourceLinks,
}).strict().superRefine((receipt, context) => {
  const expectedReceiptId = createReceiptId(receipt);
  if (receipt.receiptId !== expectedReceiptId) {
    context.addIssue({ code: "custom", path: ["receiptId"], message: "receipt ID does not match the canonical receipt payload" });
  }
  const profile = getTargetProfile(receipt.trigger.targetId);
  const registeredPlan = planForProfile(profile, receipt.plan.id);
  if (!evmAwareEqual(receipt.plan, registeredPlan)) {
    context.addIssue({ code: "custom", path: ["plan"], message: "receipt plan does not belong to the selected target profile" });
  }
  const selected = receipt.plan.selectedChecks;
  const executed = receipt.checks.map(({ id }) => id);
  if (selected.length !== executed.length || selected.some((id, index) => id !== executed[index])) {
    context.addIssue({ code: "custom", path: ["checks"], message: "receipt checks must exactly match the selected plan checks" });
  }
  if (receipt.checks.length > receipt.plan.capabilityBudget.maximumReads) {
    context.addIssue({ code: "custom", path: ["checks"], message: "receipt exceeds the selected plan read budget" });
  }
  const capabilityUses = new Map<string, number>();
  const addCapability = (name: string) => capabilityUses.set(name, (capabilityUses.get(name) ?? 0) + 1);
  const exactParameters = (actual: Record<string, string>, expected: Record<string, string>) => {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index] && evmAwareStringEqual(actual[key] ?? "", expected[key] ?? ""));
  };
  const expectedBlockTag = (definition: ProfileInvestigationCheck) => toHex(BigInt(
    definition.block === "previous" ? profile.investigation.previousBlock : profile.investigation.upgradeBlock,
  ));
  const expectedParameters = (definition: ProfileInvestigationCheck): Record<string, string> => {
    if (definition.kind === "storage-address") return { address: definition.address, slot: definition.slot };
    if (definition.kind === "implementation-code") return { address: receipt.trigger.decodedArguments.implementation };
    return { to: definition.to, data: definition.data };
  };
  const expectedAssertion = (definition: ProfileInvestigationCheck): string => {
    if (definition.kind === "storage-address" || definition.kind === "call-address") return definition.expectedAddress;
    if (definition.kind === "implementation-code") return `${definition.expectedByteLength} bytes`;
    return definition.expectedValue;
  };
  for (const [index, check] of receipt.checks.entries()) {
    const resultActual = check.result?.kind === "bytecode"
      ? `${check.result.byteLength} bytes`
      : check.result?.value ?? null;
    if (check.status === "passed") {
      if (check.assertion.matches !== true) {
        context.addIssue({ code: "custom", path: ["checks", index, "assertion", "matches"], message: "a passed check must have a matching assertion" });
      }
      if (check.result === null) {
        context.addIssue({ code: "custom", path: ["checks", index, "result"], message: "a passed check must contain a result" });
      }
      if (check.failure !== null) {
        context.addIssue({ code: "custom", path: ["checks", index, "failure"], message: "a passed check cannot contain failure details" });
      }
    } else if (check.status === "mismatch") {
      if (check.assertion.matches !== false) {
        context.addIssue({ code: "custom", path: ["checks", index, "assertion", "matches"], message: "a mismatched check must have a non-matching assertion" });
      }
      if (check.result === null) {
        context.addIssue({ code: "custom", path: ["checks", index, "result"], message: "a mismatched check must contain a result" });
      }
      if (check.failure !== null) {
        context.addIssue({ code: "custom", path: ["checks", index, "failure"], message: "a mismatched check cannot contain failure details" });
      }
    } else {
      if (check.failure === null) {
        context.addIssue({ code: "custom", path: ["checks", index, "failure"], message: "a failed or unsupported check must contain failure details" });
      }
      if (check.result !== null) {
        context.addIssue({ code: "custom", path: ["checks", index, "result"], message: "a failed or unsupported check cannot contain a result" });
      }
      if (check.assertion.actual !== null || check.assertion.matches !== null) {
        context.addIssue({ code: "custom", path: ["checks", index, "assertion"], message: "an unavailable check cannot claim an actual result or match" });
      }
    }
    if (resultActual !== null && !evmAwareStringEqual(check.assertion.actual ?? "", resultActual)) {
      context.addIssue({ code: "custom", path: ["checks", index, "assertion", "actual"], message: "assertion actual must match the normalized check result" });
    }
    const definition = profile.investigation.checks.find(({ id }) => id === check.id);
    const validScope = Boolean(definition
      && check.required === definition.required
      && check.method === definition.method
      && check.blockTag === expectedBlockTag(definition)
      && exactParameters(check.parameters, expectedParameters(definition))
      && check.assertion.description === definition.description
      && evmAwareStringEqual(check.assertion.expected, expectedAssertion(definition)));
    if (definition) addCapability(definition.capability);
    if (!validScope) {
      context.addIssue({ code: "custom", path: ["checks", index], message: "receipt check is outside the fixed investigation scope" });
    }
  }
  for (const capability of receipt.plan.capabilityBudget.capabilities) {
    if ((capabilityUses.get(capability.name) ?? 0) > capability.maximumUses) {
      context.addIssue({ code: "custom", path: ["checks"], message: `receipt exceeds the ${capability.name} budget` });
    }
  }
  const requiredChecks = receipt.checks.filter(({ required }) => required);
  const expectedDisposition = receipt.plan.id === "stop-incomplete"
    ? "incomplete"
    : requiredChecks.some(({ status }) => status === "mismatch")
      ? "contradicted"
      : requiredChecks.some(({ status }) => status === "failed" || status === "unsupported")
        ? "incomplete"
        : "corroborated";
  if (receipt.finalDisposition !== expectedDisposition) {
    context.addIssue({ code: "custom", path: ["finalDisposition"], message: "receipt disposition does not match required check assertions" });
  }
  const checkFailures = receipt.checks.flatMap((check) => check.failure ? [check.failure] : []);
  if (JSON.stringify(receipt.errors) !== JSON.stringify(checkFailures)) {
    context.addIssue({ code: "custom", path: ["errors"], message: "receipt errors must exactly match recorded check failures" });
  }
});

export const evidenceSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["complete", "incomplete"]),
  network: z.object({ name: z.string().min(1), chainId: z.number().int().positive() }),
  block: z.object({ number: decimalString, hash, timestamp: z.iso.datetime().nullable() }),
  transaction: z.object({ hash, sender: address.nullable(), recipient: address.nullable(), receiptStatus: z.enum(["success", "reverted"]).nullable() }),
  log: z.object({ index: decimalString, emitter: address, topic0: hash, rawTopics: z.array(hash).min(1) }),
  event: z.object({ signature: z.string().min(1), decodedArguments: z.record(z.string(), z.string()) }),
  relevantAddresses: z.array(z.object({ address, role: z.string().min(1) })).min(1),
  detector: z.object({ id: z.string().min(1), inputs: z.record(z.string(), z.string()) }),
  severity: z.object({ ruleId: z.string().min(1), inputs: z.record(z.string(), z.string()), result: z.enum(["high", "suspicious", "informational"]) }),
  upgradeInvestigation: upgradeInvestigationSchema,
  investigationReceipt: investigationReceiptSchema.nullable(),
  observedFacts: z.array(z.string().min(1)).min(1),
  sources: sourceLinks,
  errors: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })),
}).superRefine((evidence, context) => {
  if (evidence.status === "complete" && evidence.errors.length > 0) {
    context.addIssue({ code: "custom", path: ["errors"], message: "complete evidence cannot contain errors" });
  }
  if (evidence.status === "incomplete" && evidence.errors.length === 0) {
    context.addIssue({ code: "custom", path: ["errors"], message: "incomplete evidence must explain what is missing" });
  }
  const receipt = evidence.investigationReceipt;
  if (!receipt) return;
  const expectedTrigger = {
    network: evidence.network,
    targetId: receipt.trigger.targetId,
    incidentClass: "contract_upgrade",
    eventType: "proxy_upgraded",
    eventSignature: evidence.event.signature,
    decodedArguments: evidence.event.decodedArguments,
    block: evidence.block,
    transaction: evidence.transaction,
    log: evidence.log,
    detector: {
      id: evidence.detector.id,
      severityRuleId: evidence.severity.ruleId,
      severity: evidence.severity.result,
    },
  };
  const compare = (actual: unknown, expected: unknown, path: PropertyKey[], message: string) => {
    if (!evmAwareEqual(actual, expected)) {
      context.addIssue({ code: "custom", path, message });
    }
  };
  compare(receipt.trigger, expectedTrigger, ["investigationReceipt", "trigger"], "receipt trigger must match its containing evidence");
  compare(receipt.plan, evidence.upgradeInvestigation.plan, ["investigationReceipt", "plan"], "receipt plan must match its containing investigation");
  compare(receipt.checks, evidence.upgradeInvestigation.checks, ["investigationReceipt", "checks"], "receipt checks must match its containing investigation");
  compare(receipt.finalDisposition, evidence.upgradeInvestigation.disposition, ["investigationReceipt", "finalDisposition"], "receipt disposition must match its containing investigation");
  compare(receipt.explorerLinks, evidence.sources, ["investigationReceipt", "explorerLinks"], "receipt explorer links must match its containing evidence");
});

export const alertSchema = z.object({
  id: z.string().min(1),
  scanId: z.string().min(1),
  targetId: targetProfileIdSchema,
  incidentClass: z.literal("contract_upgrade"),
  eventType: z.literal("proxy_upgraded"),
  classificationLabel: z.literal("Contract upgrade"),
  severity: z.enum(["high", "suspicious", "informational"]),
  severityRuleId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  investigation: investigationSchema,
  observedAt: z.iso.datetime().nullable(),
  evidenceStatus: z.enum(["complete", "incomplete"]),
  evidenceId: z.string().min(1),
  sources: sourceLinks,
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Alert = z.infer<typeof alertSchema>;
export type UpgradeInvestigation = z.infer<typeof upgradeInvestigationSchema>;
export type UpgradeInvestigationCheck = z.infer<typeof upgradeInvestigationCheckSchema>;
export type InvestigationReceipt = z.infer<typeof investigationReceiptSchema>;
export type InvestigationReceiptTrigger = z.infer<typeof investigationReceiptTriggerSchema>;

export const scanFailureSchema = z.object({
  code: z.string().min(1),
  stage: z.enum(["validation", "rpc", "decode", "evidence"]),
  category: z.enum(["dns", "timeout", "rate-limit", "wrong-chain", "malformed-response", "incomplete-evidence", "unsupported", "unavailable"]).optional(),
  message: z.string().min(1),
  blockNumber: decimalString.optional(),
  transactionHash: hash.optional(),
  logIndex: decimalString.optional(),
});

export const scanResultSchema = z.object({
  scanId: z.string().min(1),
  targetId: targetProfileIdSchema,
  range: z.object({ fromBlock: decimalString, toBlock: decimalString }),
  status: z.enum(["complete", "partial", "failed"]),
  alerts: z.array(alertSchema),
  evidence: z.array(evidenceSchema),
  failures: z.array(scanFailureSchema),
});

export type ScanFailure = z.infer<typeof scanFailureSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
