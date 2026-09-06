import { agentDecisionSchema, agentDecisionInputSchema, type AgentDecision, type AgentDecisionInput } from "./schemas.js";
import { AGENT_CALL_TIMEOUT_MS, AgentProviderError, type AgentLogEvent, type InvestigationAgentProvider } from "./provider.js";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Fetch = typeof fetch;

const decisionJsonSchema = {
  type: "object",
  oneOf: [
    {
      additionalProperties: false,
      required: ["action", "checkId", "rationale", "narrative", "uncertainty"],
      properties: {
        action: { const: "run_check" },
        checkId: { type: "string" },
        rationale: { type: "string", minLength: 1, maxLength: 400 },
        narrative: { type: "string", maxLength: 1000 },
        uncertainty: { type: "string", maxLength: 500 },
      },
    },
    {
      additionalProperties: false,
      required: ["action", "rationale", "narrative", "uncertainty"],
      properties: {
        action: { const: "finish" },
        rationale: { type: "string", minLength: 1, maxLength: 400 },
        narrative: { type: "string", minLength: 1, maxLength: 1000 },
        uncertainty: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
  ],
} as const;

function safeContent(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : undefined;
  return message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
}

function abortSignal(parent?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const timeout = AbortSignal.timeout(AGENT_CALL_TIMEOUT_MS);
  return { signal: parent ? AbortSignal.any([parent, timeout]) : timeout, cleanup: () => undefined };
}

export class OpenRouterAgentProvider implements InvestigationAgentProvider {
  readonly provider = "openrouter" as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  async decide(input: AgentDecisionInput, parentSignal?: AbortSignal): Promise<AgentDecision> {
    const parsedInput = agentDecisionInputSchema.parse(input);
    const { signal, cleanup } = abortSignal(parentSignal);
    try {
      const response = await this.fetchImplementation(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Watchtower",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "You are Watchtower's bounded investigation planner. Use only the supplied registered check IDs. Return a short public rationale, narrative, and uncertainty statement. Never invent chain facts or request raw RPC parameters.",
            },
            { role: "user", content: JSON.stringify(parsedInput) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "watchtower_agent_decision", strict: true, schema: decisionJsonSchema },
          },
        }),
        signal,
      });
      if (!response.ok) throw new AgentProviderError("The investigation provider returned an unsuccessful response.", "provider");
      const payload = await response.json() as unknown;
      const content = safeContent(payload);
      if (typeof content !== "string") throw new AgentProviderError("The investigation provider returned no structured decision.", "invalid-output");
      let decoded: unknown;
      try {
        decoded = JSON.parse(content);
      } catch {
        throw new AgentProviderError("The investigation provider returned malformed structured output.", "invalid-output");
      }
      const decision = agentDecisionSchema.safeParse(decoded);
      if (!decision.success) throw new AgentProviderError("The investigation provider returned an invalid decision.", "invalid-output");
      return decision.data;
    } catch (error) {
      if (error instanceof AgentProviderError) throw error;
      if (signal.aborted) throw new AgentProviderError("The investigation provider request timed out or was cancelled.", "timeout");
      throw new AgentProviderError("The investigation provider request failed.", "provider");
    } finally {
      cleanup();
    }
  }
}

function logAgentEvent(event: AgentLogEvent): void {
  console.info(JSON.stringify({ scope: "watchtower-agent", ...event }));
}

export function createOpenRouterRuntime(input: { apiKey?: string; model?: string; log?: (event: AgentLogEvent) => void }): import("./provider.js").AgentRuntime {
  const apiKey = input.apiKey?.trim();
  const model = input.model?.trim() || null;
  return {
    providerName: "openrouter",
    model,
    provider: apiKey && model ? new OpenRouterAgentProvider(model, apiKey) : null,
    log: input.log ?? logAgentEvent,
  };
}
