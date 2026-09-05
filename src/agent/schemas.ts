import { z } from "zod";

import { investigationCheckIdSchema } from "../investigation/plans.js";
import { targetProfileIdSchema } from "../profiles/registry.js";

const conciseText = z.string().trim().min(1).max(400);

export const agentCheckSummarySchema = z.object({
  checkId: investigationCheckIdSchema,
  status: z.enum(["passed", "mismatch", "failed", "unsupported"]),
  description: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().nullable(),
}).strict();

export const agentDecisionInputSchema = z.object({
  targetId: targetProfileIdSchema,
  eventSignature: z.literal("Upgraded(address)"),
  decodedImplementation: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  severity: z.enum(["high", "suspicious", "informational"]),
  severityRuleId: z.enum(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]),
  planId: z.enum(["corroborate-approved-upgrade", "escalate-unapproved-upgrade", "stop-incomplete"]),
  step: z.number().int().min(1).max(3),
  maximumSteps: z.literal(3),
  availableCheckIds: z.array(investigationCheckIdSchema).max(3),
  completedChecks: z.array(agentCheckSummarySchema).max(6),
}).strict();

export const agentDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run_check"),
    checkId: investigationCheckIdSchema,
    rationale: conciseText,
    narrative: z.string().trim().max(1_000),
    uncertainty: z.string().trim().max(500),
  }).strict(),
  z.object({
    action: z.literal("finish"),
    rationale: conciseText,
    narrative: z.string().trim().min(1).max(1_000),
    uncertainty: z.string().trim().min(1).max(500),
  }).strict(),
]);

export const agentToolRequestSchema = z.object({
  action: z.literal("run_check"),
  checkId: investigationCheckIdSchema,
  rationale: conciseText,
  narrative: z.string().trim().max(1_000),
  uncertainty: z.string().trim().max(500),
}).strict();

export const agentStepSchema = z.object({
  step: z.number().int().min(1).max(3),
  requestedCheckId: investigationCheckIdSchema,
  rationale: conciseText,
  toolResultRef: investigationCheckIdSchema,
  outcome: z.enum(["passed", "mismatch", "failed", "unsupported"]),
}).strict();

const agentFailureSchema = z.object({
  code: z.enum([
    "agent-credentials-missing",
    "agent-provider-timeout",
    "agent-provider-error",
    "agent-output-invalid",
    "agent-tool-request-invalid",
    "agent-step-limit",
  ]),
  category: z.enum(["unavailable", "timeout", "provider", "invalid-output", "invalid-tool", "step-limit"]),
  message: z.string().min(1).max(240),
}).strict();

export const agentInvestigationSchema = z.object({
  status: z.enum(["not-run", "unavailable", "failed", "complete"]),
  provider: z.literal("openrouter").nullable(),
  model: z.string().min(1).max(200).nullable(),
  steps: z.array(agentStepSchema).max(3),
  narrative: z.string().min(1).max(1_000).nullable(),
  uncertainty: z.string().min(1).max(500).nullable(),
  failure: agentFailureSchema.nullable(),
}).strict().superRefine((record, context) => {
  if (record.status === "complete" && (record.failure || !record.narrative || !record.uncertainty)) {
    context.addIssue({ code: "custom", message: "a complete agent investigation requires narrative and uncertainty without failure" });
  }
  if ((record.status === "unavailable" || record.status === "failed") && !record.failure) {
    context.addIssue({ code: "custom", path: ["failure"], message: "an unavailable or failed agent investigation requires a safe failure" });
  }
  if (record.status === "not-run" && (record.provider || record.model || record.steps.length || record.narrative || record.uncertainty || record.failure)) {
    context.addIssue({ code: "custom", message: "a not-run agent investigation cannot imply model execution" });
  }
});

export type AgentDecisionInput = z.infer<typeof agentDecisionInputSchema>;
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentInvestigation = z.infer<typeof agentInvestigationSchema>;

export const notRunAgentInvestigation = agentInvestigationSchema.parse({
  status: "not-run",
  provider: null,
  model: null,
  steps: [],
  narrative: null,
  uncertainty: null,
  failure: null,
});
