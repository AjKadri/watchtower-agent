import { z } from "zod";

import { agentDecisionSchema, agentDecisionInputSchema, type AgentDecision, type AgentDecisionInput } from "./schemas.js";
import { AGENT_CALL_TIMEOUT_MS, AgentProviderError, type AgentLogEvent, type InvestigationAgentProvider } from "./provider.js";
import { investigationCheckIdSchema } from "../investigation/plans.js";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Fetch = typeof fetch;

function decisionJsonSchemaForStep(step: AgentDecisionInput["step"]) {
  const finalStep = step === 3;
  return {
    type: "object",
    additionalProperties: false,
    required: ["action", "checkId", "rationale", "narrative", "uncertainty"],
    properties: {
      action: { type: "string", enum: finalStep ? ["finish"] : ["run_check", "finish"] },
      checkId: finalStep ? { type: "null" } : { enum: [...investigationCheckIdSchema.options, null] },
      rationale: { type: "string", minLength: 1, maxLength: 400 },
      narrative: { type: "string", maxLength: 1000 },
      uncertainty: { type: "string", maxLength: 500 },
    },
  } as const;
}

const providerDecisionSchema = z.object({
  action: z.enum(["run_check", "finish"]),
  checkId: z.union([investigationCheckIdSchema, z.null()]),
  rationale: z.string().trim().min(1).max(400),
  narrative: z.string().trim().max(1_000),
  uncertainty: z.string().trim().max(500),
}).strict();

function invalidDecision(): AgentProviderError {
  return new AgentProviderError("The investigation provider returned an invalid decision.", "invalid-output");
}

function normalizeProviderDecision(decoded: unknown, input: AgentDecisionInput): AgentDecision {
  const parsed = providerDecisionSchema.safeParse(decoded);
  if (!parsed.success) throw invalidDecision();

  if (parsed.data.action === "run_check") {
    if (parsed.data.checkId === null || !input.availableCheckIds.includes(parsed.data.checkId)) throw invalidDecision();
    const decision = agentDecisionSchema.safeParse(parsed.data);
    if (!decision.success) throw invalidDecision();
    return decision.data;
  }

  if (parsed.data.checkId !== null) throw invalidDecision();
  const decision = agentDecisionSchema.safeParse({
    action: "finish",
    rationale: parsed.data.rationale,
    narrative: parsed.data.narrative,
    uncertainty: parsed.data.uncertainty,
  });
  if (!decision.success) throw invalidDecision();
  return decision.data;
}

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
              content: "You are Watchtower's bounded investigation planner. Use only the supplied registered check IDs. Before the final decision, you may request one supplied check at a time. On the final decision (step 3), you must return action finish with checkId null. A pre-check narrative is not a final conclusion; provide the post-check narrative only with finish. Return a short public rationale, narrative, and uncertainty statement. Never invent chain facts or request raw RPC parameters.",
            },
            { role: "user", content: JSON.stringify(parsedInput) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "watchtower_agent_decision", strict: true, schema: decisionJsonSchemaForStep(parsedInput.step) },
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
      return normalizeProviderDecision(decoded, parsedInput);
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
