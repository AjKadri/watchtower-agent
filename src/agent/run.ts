import type { Address } from "../chain/types.js";
import type { UpgradeInvestigationCheck } from "../domain/schemas.js";
import type { RegisteredCheckExecutor } from "../investigation/checks.js";
import type { InvestigationCheckId } from "../investigation/plans.js";
import type { TargetProfileId } from "../profiles/registry.js";
import { AGENT_MAXIMUM_STEPS, AGENT_TOTAL_TIMEOUT_MS, AgentProviderError, type AgentRuntime } from "./provider.js";
import { agentInvestigationSchema, notRunAgentInvestigation, type AgentDecisionInput, type AgentInvestigation } from "./schemas.js";
import { executeAgentTool } from "./tools.js";

const initialCheckIds = new Set<InvestigationCheckId>([
  "implementation-before",
  "implementation-at-upgrade",
  "implementation-bytecode",
]);

export type AgentRunContext = {
  targetId: TargetProfileId;
  eventSignature: "Upgraded(address)";
  decodedImplementation: Address;
  severity: "high" | "suspicious" | "informational";
  severityRuleId: "target-is-zero-address" | "target-is-not-approved" | "target-is-approved";
};

function summarize(check: UpgradeInvestigationCheck) {
  return {
    checkId: check.id,
    status: check.status,
    description: check.assertion.description,
    expected: check.assertion.expected,
    actual: check.assertion.actual,
  };
}

function failureRecord(
  runtime: AgentRuntime,
  steps: AgentInvestigation["steps"],
  code: NonNullable<AgentInvestigation["failure"]>["code"],
  category: NonNullable<AgentInvestigation["failure"]>["category"],
  message: string,
): AgentInvestigation {
  return agentInvestigationSchema.parse({
    status: code === "agent-credentials-missing" ? "unavailable" : "failed",
    provider: runtime.providerName,
    model: runtime.model,
    steps,
    narrative: null,
    uncertainty: null,
    failure: { code, category, message },
  });
}

export async function runInitialDeterministicChecks(executor: RegisteredCheckExecutor): Promise<void> {
  await Promise.all(executor.remainingCheckIds().filter((id) => initialCheckIds.has(id)).map((id) => executor.run(id)));
}

export async function runBoundedInvestigationAgent(
  executor: RegisteredCheckExecutor,
  context: AgentRunContext,
  runtime?: AgentRuntime,
  parentSignal?: AbortSignal,
): Promise<AgentInvestigation> {
  if (!runtime) return notRunAgentInvestigation;
  if (!runtime.provider) {
    return failureRecord(runtime, [], "agent-credentials-missing", "unavailable", "The bounded investigation agent is unavailable because its server-side configuration is incomplete.");
  }

  const totalTimeout = AbortSignal.timeout(AGENT_TOTAL_TIMEOUT_MS);
  const signal = parentSignal ? AbortSignal.any([parentSignal, totalTimeout]) : totalTimeout;
  const steps: AgentInvestigation["steps"] = [];
  for (let step = 1; step <= AGENT_MAXIMUM_STEPS; step += 1) {
    const input: AgentDecisionInput = {
      ...context,
      planId: executor.plan.id,
      step,
      maximumSteps: AGENT_MAXIMUM_STEPS,
      availableCheckIds: executor.remainingCheckIds(),
      completedChecks: executor.completedChecks().map(summarize),
    };
    let decision;
    try {
      decision = await runtime.provider.decide(input, signal);
    } catch (error) {
      const providerError = error instanceof AgentProviderError
        ? error
        : new AgentProviderError("The investigation provider failed.", "provider");
      const timedOut = providerError.category === "timeout" || signal.aborted;
      return failureRecord(
        runtime,
        steps,
        timedOut ? "agent-provider-timeout" : providerError.category === "invalid-output" ? "agent-output-invalid" : "agent-provider-error",
        timedOut ? "timeout" : providerError.category === "invalid-output" ? "invalid-output" : "provider",
        providerError.message,
      );
    }

    if (decision.action === "finish") {
      return agentInvestigationSchema.parse({
        status: "complete",
        provider: runtime.providerName,
        model: runtime.model,
        steps,
        narrative: decision.narrative,
        uncertainty: decision.uncertainty,
        failure: null,
      });
    }

    try {
      const result = await executeAgentTool(executor, decision);
      steps.push({ step, requestedCheckId: decision.checkId, rationale: decision.rationale, toolResultRef: result.id, outcome: result.status });
    } catch {
      return failureRecord(runtime, steps, "agent-tool-request-invalid", "invalid-tool", "The bounded agent requested a check outside its current registered tool scope.");
    }
  }

  return failureRecord(runtime, steps, "agent-step-limit", "step-limit", "The bounded investigation agent reached its three-step decision limit.");
}
