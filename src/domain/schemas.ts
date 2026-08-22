import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const sourceLinks = z.object({
  transaction: z.url(),
  block: z.url(),
  addresses: z.record(z.string(), z.url()),
});

export const evidenceSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["complete", "incomplete"]),
  network: z.object({ name: z.string().min(1), chainId: z.number().int().positive() }),
  block: z.object({ number: decimalString, hash, timestamp: z.iso.datetime() }),
  transaction: z.object({ hash, sender: address, recipient: address.nullable(), receiptStatus: z.enum(["success", "reverted"]) }),
  log: z.object({ index: decimalString, emitter: address, topic0: hash, rawTopics: z.array(hash).min(1) }),
  event: z.object({ signature: z.string().min(1), decodedArguments: z.record(z.string(), z.string()) }),
  relevantAddresses: z.array(z.object({ address, role: z.string().min(1) })).min(1),
  detector: z.object({ id: z.string().min(1), inputs: z.record(z.string(), z.string()) }),
  severity: z.object({ ruleId: z.string().min(1), inputs: z.record(z.string(), z.string()), result: z.enum(["high", "suspicious", "informational"]) }),
  observedFacts: z.array(z.string().min(1)).min(1),
  sources: sourceLinks,
  errors: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })),
});

export const alertSchema = z.object({
  id: z.string().min(1),
  scanId: z.string().min(1),
  targetId: z.string().min(1),
  incidentClass: z.enum(["ownership_admin", "upgrade_pause"]),
  eventType: z.string().min(1),
  severity: z.enum(["high", "suspicious", "informational"]),
  severityRuleId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  observedAt: z.iso.datetime(),
  evidenceStatus: z.enum(["complete", "incomplete"]),
  evidenceId: z.string().min(1),
  sources: sourceLinks,
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Alert = z.infer<typeof alertSchema>;
