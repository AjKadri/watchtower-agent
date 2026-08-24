import { z } from "zod";

export const investigationCheckIdSchema = z.enum([
  "implementation-before",
  "implementation-at-upgrade",
  "implementation-bytecode",
  "configured-pool",
  "pool-revision-before",
  "pool-revision-at-upgrade",
]);

export const investigationCapabilitySchema = z.enum([
  "historical-storage-read",
  "historical-code-read",
  "historical-contract-call",
]);

const requiredChecks = [
  "implementation-before",
  "implementation-at-upgrade",
  "implementation-bytecode",
  "configured-pool",
] as const;
const optionalChecks = ["pool-revision-before", "pool-revision-at-upgrade"] as const;
const allChecks = [...requiredChecks, ...optionalChecks] as const;
const requiredCheckSchemas = requiredChecks.map((id) => z.literal(id)) as [
  z.ZodLiteral<"implementation-before">,
  z.ZodLiteral<"implementation-at-upgrade">,
  z.ZodLiteral<"implementation-bytecode">,
  z.ZodLiteral<"configured-pool">,
];
const optionalCheckSchemas = optionalChecks.map((id) => z.literal(id)) as [
  z.ZodLiteral<"pool-revision-before">,
  z.ZodLiteral<"pool-revision-at-upgrade">,
];
const allCheckSchemas = allChecks.map((id) => z.literal(id)) as [
  ...typeof requiredCheckSchemas,
  ...typeof optionalCheckSchemas,
];

const corroboratePlanSchema = z.object({
  id: z.literal("corroborate-approved-upgrade"),
  version: z.literal("1.0.0"),
  selectionReason: z.object({
    code: z.literal("approved-target"),
    text: z.literal("The deterministic severity rule identified the decoded implementation as the configured approved target."),
  }).strict(),
  selectedChecks: z.tuple(allCheckSchemas),
  skippedChecks: z.tuple([]),
  capabilityBudget: z.object({
    maximumReads: z.literal(6),
    capabilities: z.tuple([
      z.object({ name: z.literal("historical-storage-read"), maximumUses: z.literal(2) }).strict(),
      z.object({ name: z.literal("historical-code-read"), maximumUses: z.literal(1) }).strict(),
      z.object({ name: z.literal("historical-contract-call"), maximumUses: z.literal(3) }).strict(),
    ]),
  }).strict(),
}).strict();

const escalatePlanSchema = z.object({
  id: z.literal("escalate-unapproved-upgrade"),
  version: z.literal("1.0.0"),
  selectionReason: z.object({
    code: z.literal("unapproved-target"),
    text: z.literal("The deterministic severity rule identified a zero or unapproved decoded implementation."),
  }).strict(),
  selectedChecks: z.tuple(requiredCheckSchemas),
  skippedChecks: z.tuple(optionalCheckSchemas),
  capabilityBudget: z.object({
    maximumReads: z.literal(4),
    capabilities: z.tuple([
      z.object({ name: z.literal("historical-storage-read"), maximumUses: z.literal(2) }).strict(),
      z.object({ name: z.literal("historical-code-read"), maximumUses: z.literal(1) }).strict(),
      z.object({ name: z.literal("historical-contract-call"), maximumUses: z.literal(1) }).strict(),
    ]),
  }).strict(),
}).strict();

const stopPlanSchema = z.object({
  id: z.literal("stop-incomplete"),
  version: z.literal("1.0.0"),
  selectionReason: z.object({
    code: z.literal("trigger-evidence-incomplete"),
    text: z.literal("Complete trigger evidence is unavailable, so no historical investigation reads are permitted."),
  }).strict(),
  selectedChecks: z.tuple([]),
  skippedChecks: z.tuple(allCheckSchemas),
  capabilityBudget: z.object({
    maximumReads: z.literal(0),
    capabilities: z.tuple([]),
  }).strict(),
}).strict();

export const investigationPlanSchema = z.discriminatedUnion("id", [
  corroboratePlanSchema,
  escalatePlanSchema,
  stopPlanSchema,
]);

export const investigationPlanningInputSchema = z.object({
  targetId: z.literal("aave-v3-base-core"),
  eventSignature: z.literal("Upgraded(address)"),
  triggerEvidenceStatus: z.enum(["complete", "incomplete"]),
  severityRuleId: z.enum(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]),
}).strict();

export type InvestigationPlan = z.infer<typeof investigationPlanSchema>;
export type InvestigationCheckId = z.infer<typeof investigationCheckIdSchema>;
export type InvestigationCapability = z.infer<typeof investigationCapabilitySchema>;

const plans = {
  corroborate: corroboratePlanSchema.parse({
    id: "corroborate-approved-upgrade",
    version: "1.0.0",
    selectionReason: {
      code: "approved-target",
      text: "The deterministic severity rule identified the decoded implementation as the configured approved target.",
    },
    selectedChecks: allChecks,
    skippedChecks: [],
    capabilityBudget: {
      maximumReads: 6,
      capabilities: [
        { name: "historical-storage-read", maximumUses: 2 },
        { name: "historical-code-read", maximumUses: 1 },
        { name: "historical-contract-call", maximumUses: 3 },
      ],
    },
  }),
  escalate: escalatePlanSchema.parse({
    id: "escalate-unapproved-upgrade",
    version: "1.0.0",
    selectionReason: {
      code: "unapproved-target",
      text: "The deterministic severity rule identified a zero or unapproved decoded implementation.",
    },
    selectedChecks: requiredChecks,
    skippedChecks: optionalChecks,
    capabilityBudget: {
      maximumReads: 4,
      capabilities: [
        { name: "historical-storage-read", maximumUses: 2 },
        { name: "historical-code-read", maximumUses: 1 },
        { name: "historical-contract-call", maximumUses: 1 },
      ],
    },
  }),
  stop: stopPlanSchema.parse({
    id: "stop-incomplete",
    version: "1.0.0",
    selectionReason: {
      code: "trigger-evidence-incomplete",
      text: "Complete trigger evidence is unavailable, so no historical investigation reads are permitted.",
    },
    selectedChecks: [],
    skippedChecks: allChecks,
    capabilityBudget: { maximumReads: 0, capabilities: [] },
  }),
} as const;

export function selectInvestigationPlan(input: unknown): InvestigationPlan {
  const parsed = investigationPlanningInputSchema.parse(input);
  if (parsed.triggerEvidenceStatus === "incomplete") return plans.stop;
  if (parsed.severityRuleId === "target-is-approved") return plans.corroborate;
  return plans.escalate;
}
