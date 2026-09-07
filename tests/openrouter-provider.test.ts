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

const finalInput: AgentDecisionInput = { ...input, step: 3 };

const runCheckDecision = {
  action: "run_check",
  checkId: "endpoint-at-upgrade",
  rationale: "Check the registered endpoint result before concluding.",
  narrative: "The initial deterministic checks are available for review.",
  uncertainty: "The endpoint check remains to be evaluated.",
} as const;

const finishDecision = {
  action: "finish",
  checkId: null,
  rationale: "The required registered checks are sufficient.",
  narrative: "The deterministic checks provide the recorded evidence.",
  uncertainty: "This does not establish implementation safety.",
} as const;

function providerFor(content: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status, headers: { "content-type": "application/json" } }));
  return {
    provider: new OpenRouterAgentProvider("example/model", "secret-value", fetchMock),
    fetchMock,
  };
}

async function expectInvalidDecision(content: unknown, decisionInput: AgentDecisionInput = input) {
  const { provider } = providerFor(typeof content === "string" ? content : JSON.stringify(content));
  await expect(provider.decide(decisionInput)).rejects.toMatchObject({ category: "invalid-output" });
}

describe("OpenRouter agent provider", () => {
  it("uses the fixed endpoint and validates a flat run_check decision", async () => {
    const { provider, fetchMock } = providerFor(JSON.stringify(runCheckDecision));

    await expect(provider.decide(input)).resolves.toEqual(runCheckDecision);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.body).not.toContain("secret-value");
    expect(options.body).not.toContain("rpcUrl");

    const request = JSON.parse(String(options.body));
    const schema = request.response_format.json_schema.schema;
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action", "checkId", "rationale", "narrative", "uncertainty"],
      properties: {
        action: { type: "string", enum: ["run_check", "finish"] },
      },
    });
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema.properties.checkId.enum).toContain("endpoint-at-upgrade");
    expect(schema.properties.checkId.enum).toContain(null);
  });

  it("sends a finish-only schema on the final decision", async () => {
    const { provider, fetchMock } = providerFor(JSON.stringify(finishDecision));

    await expect(provider.decide(finalInput)).resolves.toEqual({
      action: "finish",
      rationale: finishDecision.rationale,
      narrative: finishDecision.narrative,
      uncertainty: finishDecision.uncertainty,
    });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const request = JSON.parse(String(options.body));
    const schema = request.response_format.json_schema.schema;
    expect(schema.properties.action).toEqual({ type: "string", enum: ["finish"] });
    expect(schema.properties.checkId).toEqual({ type: "null" });
    expect(request.messages[0].content).toContain("On the final decision (step 3), you must return action finish with checkId null.");
  });

  it("normalizes a valid finish decision with a null check ID", async () => {
    const { provider } = providerFor(JSON.stringify(finishDecision));

    await expect(provider.decide(input)).resolves.toEqual({
      action: "finish",
      rationale: finishDecision.rationale,
      narrative: finishDecision.narrative,
      uncertainty: finishDecision.uncertainty,
    });
  });

  it("rejects finish decisions with a non-null check ID", async () => {
    await expectInvalidDecision({ ...finishDecision, checkId: "endpoint-at-upgrade" });
  });

  it("rejects run_check decisions with a null check ID", async () => {
    await expectInvalidDecision({ ...runCheckDecision, checkId: null });
  });

  it("rejects a registered check that is unavailable in the current input", async () => {
    await expectInvalidDecision({ ...runCheckDecision, checkId: "implementation-before" });
  });

  it("rejects unknown check IDs", async () => {
    await expectInvalidDecision({ ...runCheckDecision, checkId: "not-registered" });
  });

  it("rejects unknown actions", async () => {
    await expectInvalidDecision({ ...runCheckDecision, action: "review" });
  });

  it("rejects missing required fields", async () => {
    const { checkId: _checkId, ...missingCheckId } = runCheckDecision;
    await expectInvalidDecision(missingCheckId);
  });

  it("rejects extra properties", async () => {
    await expectInvalidDecision({ ...runCheckDecision, extra: "reject" });
  });

  it("rejects double-encoded JSON", async () => {
    await expectInvalidDecision(JSON.stringify(JSON.stringify(runCheckDecision)));
  });

  it("rejects malformed JSON", async () => {
    await expectInvalidDecision("{\"action\":");
  });

  it("rejects free-form output", async () => {
    await expectInvalidDecision("Trust me");
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
