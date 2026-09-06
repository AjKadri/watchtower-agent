import type { AgentDecision, AgentDecisionInput } from "./schemas.js";

export const AGENT_MAXIMUM_STEPS = 3 as const;
export const AGENT_CALL_TIMEOUT_MS = 3_000;
export const AGENT_TOTAL_TIMEOUT_MS = 10_000;

export type AgentProviderFailureCategory = "timeout" | "provider" | "invalid-output";

export class AgentProviderError extends Error {
  constructor(
    message: string,
    readonly category: AgentProviderFailureCategory,
  ) {
    super(message);
    this.name = "AgentProviderError";
  }
}

export interface InvestigationAgentProvider {
  readonly provider: "openrouter";
  readonly model: string;
  decide(input: AgentDecisionInput, signal?: AbortSignal): Promise<AgentDecision>;
}

export type AgentLogEvent =
  | { event: "agent-start"; targetId: string; planId: string; model: string | null; maximumSteps: number }
  | { event: "agent-step"; targetId: string; step: number; remainingChecks: number }
  | { event: "agent-tool-selected"; targetId: string; step: number; checkId: string }
  | { event: "agent-tool-complete"; targetId: string; step: number; checkId: string; outcome: string }
  | { event: "agent-tool-failed"; targetId: string; step: number; checkId: string }
  | { event: "agent-complete"; targetId: string; steps: number }
  | { event: "agent-failure"; targetId: string; code: string; category: string; steps: number };

export type AgentRuntime = {
  provider: InvestigationAgentProvider | null;
  providerName: "openrouter";
  model: string | null;
  log?: (event: AgentLogEvent) => void;
};
