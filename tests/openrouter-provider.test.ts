import { describe, expect, it, vi } from "vitest";

import { OpenRouterAgentProvider, createOpenRouterRuntime } from "../src/agent/openrouter.js";
import { AgentProviderError } from "../src/agent/provider.js";
import type { AgentDecisionInput } from "../src/agent/schemas.js";

const input: AgentDecisionInput = {
  targetId: "etherfi-base-weeth-oft",
  eventSignature: "Upgraded(address)",
  decodedImplementation: "0xde8A2C33655ACA88f258988ED74D1511876343D1",
  severity: "informational",
  severityRuleId: "target-is-approved",
  planId: "corroborate-approved-upgrade",
  step: 1,
  maximumSteps: 3,
  availableCheckIds: ["endpoint-at-upgrade"],
  completedChecks: [],
};

describe("OpenRouter agent provider", () => {
  it("uses the fixed endpoint and validates a structured decision", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        action: "finish",
        rationale: "The required context is sufficient.",
        narrative: "The deterministic checks provide the recorded evidence.",
        uncertainty: "This does not establish implementation safety.",
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new OpenRouterAgentProvider("example/model", "secret-value", fetchMock);

    await expect(provider.decide(input)).resolves.toMatchObject({ action: "finish" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.body).not.toContain("secret-value");
    expect(options.body).not.toContain("rpcUrl");
  });

  it("rejects free-form and malformed provider output", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Trust me" } }] }), { status: 200 }));
    const provider = new OpenRouterAgentProvider("example/model", "secret-value", fetchMock);

    await expect(provider.decide(input)).rejects.toMatchObject({ category: "invalid-output" });
  });

  it("keeps missing credentials as an unavailable runtime instead of throwing", () => {
    expect(createOpenRouterRuntime({ model: "example/model" })).toEqual({
      providerName: "openrouter",
      model: "example/model",
      provider: null,
      log: expect.any(Function),
    });
    expect(new AgentProviderError("safe", "provider").message).toBe("safe");
  });
});
