import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);
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
  eventType: z.string().min(1),
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

export const scanFailureSchema = z.object({
  code: z.string().min(1),
  stage: z.enum(["validation", "rpc", "decode", "evidence"]),
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
