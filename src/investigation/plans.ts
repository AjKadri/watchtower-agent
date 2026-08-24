import { z } from "zod";

import {
  getTargetProfile,
  investigationCapabilitySchema,
  investigationCheckIdSchema,
  listTargetProfiles,
  planForProfile,
  registeredInvestigationPlanSchema,
  targetProfileIdSchema,
} from "../profiles/registry.js";
import { evmAwareEqual } from "../evm/address.js";

export { investigationCapabilitySchema, investigationCheckIdSchema };

const registeredPlans = listTargetProfiles().flatMap((profile) => Object.values(profile.plans));

export const investigationPlanSchema = registeredInvestigationPlanSchema.superRefine((plan, context) => {
  if (!registeredPlans.some((registered) => evmAwareEqual(plan, registered))) {
    context.addIssue({ code: "custom", message: "investigation plan is not registered for any closed target profile" });
  }
});

export const investigationPlanningInputSchema = z.object({
  targetId: targetProfileIdSchema,
  eventSignature: z.literal("Upgraded(address)"),
  triggerEvidenceStatus: z.enum(["complete", "incomplete"]),
  severityRuleId: z.enum(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]),
}).strict();

export type InvestigationPlan = z.infer<typeof investigationPlanSchema>;
export type InvestigationCheckId = z.infer<typeof investigationCheckIdSchema>;
export type InvestigationCapability = z.infer<typeof investigationCapabilitySchema>;

export function selectInvestigationPlan(input: unknown): InvestigationPlan {
  const parsed = investigationPlanningInputSchema.parse(input);
  const profile = getTargetProfile(parsed.targetId);
  if (parsed.eventSignature !== profile.detectors[0].eventSignature) {
    throw new Error("The event signature is not approved for the selected profile.");
  }
  if (parsed.triggerEvidenceStatus === "incomplete") return investigationPlanSchema.parse(profile.plans.incomplete);
  const planId = parsed.severityRuleId === "target-is-approved"
    ? "corroborate-approved-upgrade"
    : "escalate-unapproved-upgrade";
  return investigationPlanSchema.parse(planForProfile(profile, planId));
}
