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

export type AgentRuntime = {
  provider: InvestigationAgentProvider | null;
  providerName: "openrouter";
  model: string | null;
};
