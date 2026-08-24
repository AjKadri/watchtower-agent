import { z } from "zod";

import { investigationCheckIdSchema, investigationPlanSchema } from "../investigation/plans.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const blockTag = z.string().regex(/^0x[0-9a-f]+$/);
const sourceLinks = z.object({
  transaction: z.url(),
  block: z.url(),
  addresses: z.record(z.string(), z.url()),
});

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
    z.object({ kind: z.literal("address"), value: address }),
    z.object({ kind: z.literal("bytecode"), present: z.boolean(), byteLength: decimalString, hash }),
    z.object({ kind: z.literal("uint256"), value: decimalString }),
  ]).nullable(),
  assertion: z.object({
    description: z.string().min(1),
    expected: z.string().min(1),
    actual: z.string().min(1).nullable(),
    matches: z.boolean().nullable(),
  }),
  status: z.enum(["passed", "mismatch", "failed", "unsupported"]),
  failure: z.object({
    code: z.string().min(1),
    category: rpcFailureCategory,
    message: z.string().min(1),
  }).nullable(),
});

export const upgradeInvestigationSchema = z.object({
  plan: investigationPlanSchema,
  disposition: z.enum(["corroborated", "contradicted", "incomplete"]),
  evidenceStatus: z.enum(["complete", "incomplete"]),
  checks: z.array(upgradeInvestigationCheckSchema).max(6),
});

export const investigationReceiptTriggerSchema = z.object({
    network: z.object({ name: z.literal("base-mainnet"), chainId: z.literal(8453) }).strict(),
    targetId: z.literal("aave-v3-base-core"),
    incidentClass: z.literal("contract_upgrade"),
    eventType: z.literal("proxy_upgraded"),
    eventSignature: z.literal("Upgraded(address)"),
    decodedArguments: z.object({ implementation: address }).strict(),
    block: z.object({ number: z.literal("41105890"), hash, timestamp: z.iso.datetime() }).strict(),
    transaction: z.object({
      hash,
      sender: address,
      recipient: address.nullable(),
      receiptStatus: z.enum(["success", "reverted"]),
    }).strict(),
    log: z.object({
      index: decimalString,
      emitter: z.literal("0xa238dd80c259a72e81d7e4664a9801593f98d1c5").or(z.literal("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5")),
      topic0: z.literal("0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b"),
      rawTopics: z.array(hash).min(1),
    }).strict(),
    detector: z.object({ id: z.literal("aave-pool-upgraded"), severityRuleId: z.string().min(1), severity: z.enum(["high", "suspicious", "informational"]) }).strict(),
}).strict();

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
      && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key]?.toLowerCase() === expected[key]?.toLowerCase());
  };
  const proxy = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const provider = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";
  const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  for (const [index, check] of receipt.checks.entries()) {
    let validScope = false;
    if (check.id === "implementation-before") {
      validScope = check.required && check.method === "eth_getStorageAt" && check.blockTag === "0x27339e1"
        && exactParameters(check.parameters, { address: proxy, slot });
      addCapability("historical-storage-read");
    } else if (check.id === "implementation-at-upgrade") {
      validScope = check.required && check.method === "eth_getStorageAt" && check.blockTag === "0x27339e2"
        && exactParameters(check.parameters, { address: proxy, slot });
      addCapability("historical-storage-read");
    } else if (check.id === "implementation-bytecode") {
      validScope = check.required && check.method === "eth_getCode" && check.blockTag === "0x27339e2"
        && exactParameters(check.parameters, { address: receipt.trigger.decodedArguments.implementation });
      addCapability("historical-code-read");
    } else if (check.id === "configured-pool") {
      validScope = check.required && check.method === "eth_call" && check.blockTag === "0x27339e2"
        && exactParameters(check.parameters, { to: provider, data: "0x026b1d5f" });
      addCapability("historical-contract-call");
    } else if (check.id === "pool-revision-before") {
      validScope = !check.required && check.method === "eth_call" && check.blockTag === "0x27339e1"
        && exactParameters(check.parameters, { to: proxy, data: "0x0148170e" });
      addCapability("historical-contract-call");
    } else if (check.id === "pool-revision-at-upgrade") {
      validScope = !check.required && check.method === "eth_call" && check.blockTag === "0x27339e2"
        && exactParameters(check.parameters, { to: proxy, data: "0x0148170e" });
      addCapability("historical-contract-call");
    }
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
});

export const alertSchema = z.object({
  id: z.string().min(1),
  scanId: z.string().min(1),
  targetId: z.string().min(1),
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
  targetId: z.string().min(1),
  range: z.object({ fromBlock: decimalString, toBlock: decimalString }),
  status: z.enum(["complete", "partial", "failed"]),
  alerts: z.array(alertSchema),
  evidence: z.array(evidenceSchema),
  failures: z.array(scanFailureSchema),
});

export type ScanFailure = z.infer<typeof scanFailureSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
