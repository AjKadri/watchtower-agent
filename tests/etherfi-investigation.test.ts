import { describe, expect, it } from "vitest";

import { AgentProviderError, type AgentRuntime, type InvestigationAgentProvider } from "../src/agent/provider.js";
import type { AgentDecision, AgentDecisionInput } from "../src/agent/schemas.js";
import { classifyRpcError, RpcReadError, type RpcFailureCategory } from "../src/chain/errors.js";
import type {
  Address,
  ChainBlock,
  ChainLog,
  ChainLogBatch,
  ChainReader,
  ChainReceipt,
  ChainTransaction,
  Hash,
  Hex,
  LogFilter,
} from "../src/chain/types.js";
import { investigationReceiptSchema } from "../src/domain/schemas.js";
import { scanApprovedRange } from "../src/pipeline/scanner.js";
import { getTargetProfile } from "../src/profiles/registry.js";
import { readJson } from "./helpers.js";

type FixtureBlock = { number: string; hash: Hash; timestamp: string };
type FixtureTransaction = { hash: Hash; from: Address; to: Address };
type FixtureReceipt = {
  transactionHash: Hash;
  transactionIndex: string;
  blockNumber: string;
  blockHash: Hash;
  status: "success";
  selectedLogs: Array<{ logIndex: string; address: Address; topics: [Hex, ...Hex[]]; data: Hex }>;
};
type InvestigationFixture = {
  previousBlock: string;
  upgradeBlock: string;
  implementationSlot: Hex;
  implementationBeforeWord: Hex;
  implementationAtUpgradeWord: Hex;
  implementationByteLength: string;
  implementationCodeHash: Hash;
  endpointAtUpgradeResult: Hex;
  tokenAtUpgradeResult: Hex;
  sharedDecimalsAtUpgradeResult: Hex;
};

const fixtureRoot = "../fixtures/base/etherfi-weeth-oft-upgrade-23487559/";
const config = getTargetProfile("etherfi-base-weeth-oft");
const block = readJson<FixtureBlock>(`${fixtureRoot}block.json`, import.meta.url);
const transaction = readJson<FixtureTransaction>(`${fixtureRoot}transaction.json`, import.meta.url);
const receipt = readJson<FixtureReceipt>(`${fixtureRoot}receipt.json`, import.meta.url);
const investigation = readJson<InvestigationFixture>(`${fixtureRoot}investigation.json`, import.meta.url);

const fixtureLog: ChainLog = {
  ...receipt.selectedLogs[0],
  blockHash: block.hash,
  blockNumber: BigInt(block.number),
  logIndex: Number(receipt.selectedLogs[0].logIndex),
  transactionHash: receipt.transactionHash,
  transactionIndex: Number(receipt.transactionIndex),
};

class EtherfiFixtureReader implements ChainReader {
  endpointAtUpgrade = investigation.endpointAtUpgradeResult;
  failedCall: { data: Hex; category: RpcFailureCategory } | null = null;
  reads: Array<{ method: string; address: Address; blockNumber: bigint; data?: Hex }> = [];

  async getChainId(): Promise<number> { return 8453; }
  async getLatestBlockNumber(): Promise<bigint> { return 50_000_000n; }
  async getLogs(filter: LogFilter): Promise<ChainLogBatch> {
    expect(filter).toEqual({
      address: config.target.primaryContract.address,
      topic0: config.detectors[0].topic0,
      fromBlock: BigInt(investigation.upgradeBlock),
      toBlock: BigInt(investigation.upgradeBlock),
    });
    return { logs: [fixtureLog], malformed: [] };
  }
  async getBlock(_blockHash: Hash): Promise<ChainBlock> {
    return { hash: block.hash, number: BigInt(block.number), timestamp: BigInt(Date.parse(block.timestamp) / 1_000) };
  }
  async getTransaction(_transactionHash: Hash): Promise<ChainTransaction> { return transaction; }
  async getTransactionReceipt(_transactionHash: Hash): Promise<ChainReceipt> {
    return { transactionHash: receipt.transactionHash, status: receipt.status, logs: [fixtureLog] };
  }
  async getStorageAt(address: Address, slot: Hex, blockNumber: bigint): Promise<Hex> {
    this.reads.push({ method: "eth_getStorageAt", address, blockNumber, data: slot });
    return blockNumber === BigInt(investigation.previousBlock)
      ? investigation.implementationBeforeWord
      : investigation.implementationAtUpgradeWord;
  }
  async getCode(address: Address, blockNumber: bigint): Promise<Hex> {
    this.reads.push({ method: "eth_getCode", address, blockNumber });
    return `0x${"60".repeat(Number(investigation.implementationByteLength))}`;
  }
  async call(address: Address, data: Hex, blockNumber: bigint): Promise<Hex> {
    this.reads.push({ method: "eth_call", address, blockNumber, data });
    if (this.failedCall?.data === data) {
      throw new RpcReadError("historical contract call", this.failedCall.category);
    }
    if (data === "0x5e280f11") return this.endpointAtUpgrade;
    if (data === "0xfc0c546a") return investigation.tokenAtUpgradeResult;
    return investigation.sharedDecimalsAtUpgradeResult;
  }
}

describe("ether.fi Base weETH OFT investigation profile", () => {
  it("produces a complete corroborated investigation using only the six fixed historical reads", async () => {
    const reader = new EtherfiFixtureReader();
    const result = await scanApprovedRange(reader, config);

    expect(result).toMatchObject({
      status: "complete",
      targetId: "etherfi-base-weeth-oft",
      alerts: [{ severity: "informational", evidenceStatus: "complete" }],
      evidence: [{
        event: { decodedArguments: { implementation: config.expectedFixture.implementationAfter } },
        upgradeInvestigation: { disposition: "corroborated", evidenceStatus: "complete" },
        investigationReceipt: { finalDisposition: "corroborated" },
      }],
      failures: [],
    });
    expect(result.evidence[0].upgradeInvestigation?.checks.map(({ id }) => id)).toEqual([
      "implementation-before",
      "implementation-at-upgrade",
      "implementation-bytecode",
      "endpoint-at-upgrade",
      "token-at-upgrade",
      "shared-decimals-at-upgrade",
    ]);
    expect(reader.reads).toHaveLength(6);
    expect(reader.reads.every(({ address }) => address === config.target.primaryContract.address
      || address === config.expectedFixture.implementationAfter)).toBe(true);
    expect(reader.reads.every(({ blockNumber }) => blockNumber === BigInt(investigation.previousBlock)
      || blockNumber === BigInt(investigation.upgradeBlock))).toBe(true);
    expect(investigationReceiptSchema.safeParse(result.evidence[0].investigationReceipt).success).toBe(true);
    expect(result.evidence[0].agentInvestigation).toMatchObject({ status: "not-run", provider: null, steps: [] });
  });

  it("allows the agent to finish on its first decision before deterministic completion", async () => {
    const provider: InvestigationAgentProvider = {
      provider: "openrouter",
      model: "test/model",
      decide: async () => ({
        action: "finish",
        rationale: "The available deterministic evidence is sufficient.",
        narrative: "The fixed plan will complete the remaining required checks.",
        uncertainty: "This result covers only the configured historical upgrade.",
      }),
    };
    const reader = new EtherfiFixtureReader();
    const baseline = await scanApprovedRange(new EtherfiFixtureReader(), config);
    const result = await scanApprovedRange(reader, config, {}, {
      agent: { providerName: "openrouter", model: provider.model, provider },
    });

    expect(result.evidence[0].agentInvestigation).toMatchObject({
      status: "complete",
      steps: [],
      narrative: "The fixed plan will complete the remaining required checks.",
    });
    expect(reader.reads).toHaveLength(6);
    expect(result.evidence[0].upgradeInvestigation.checks).toHaveLength(6);
    expect(result.evidence[0].investigationReceipt?.receiptId).toBe(baseline.evidence[0].investigationReceipt?.receiptId);
    expect(result.evidence[0].investigationReceipt).not.toHaveProperty("narrative");
  });

  it("runs bounded live agent decisions while deterministic checks and receipt stay fixed", async () => {
    class SequencedProvider implements InvestigationAgentProvider {
      readonly provider = "openrouter" as const;
      readonly model = "test/model";
      readonly inputs: AgentDecisionInput[] = [];
      async decide(input: AgentDecisionInput): Promise<AgentDecision> {
        this.inputs.push(input);
        if (this.inputs.length === 1) {
          return {
            action: "run_check",
            checkId: "token-at-upgrade",
            rationale: "Check the registered token identity before concluding the investigation.",
            narrative: "The initial historical checks agree with the configured upgrade.",
            uncertainty: "Protocol identity checks remain.",
          };
        }
        return {
          action: "finish",
          rationale: "The approved follow-up result is available.",
          narrative: "The selected token identity and initial checks agree with the recorded profile.",
          uncertainty: "The result covers only this configured historical upgrade.",
        };
      }
    }
    const provider = new SequencedProvider();
    const logEvents: string[] = [];
    const runtime: AgentRuntime = {
      providerName: "openrouter",
      model: provider.model,
      provider,
      log: ({ event }) => logEvents.push(event),
    };
    const reader = new EtherfiFixtureReader();
    const baseline = await scanApprovedRange(new EtherfiFixtureReader(), config);
    const result = await scanApprovedRange(reader, config, {}, { agent: runtime });

    expect(provider.inputs[0].completedChecks.map(({ checkId }) => checkId)).toEqual([
      "implementation-before",
      "implementation-at-upgrade",
      "implementation-bytecode",
    ]);
    expect(provider.inputs[0].availableCheckIds).toEqual([
      "endpoint-at-upgrade",
      "token-at-upgrade",
      "shared-decimals-at-upgrade",
    ]);
    expect(result.evidence[0].agentInvestigation).toMatchObject({
      status: "complete",
      provider: "openrouter",
      model: "test/model",
      steps: [{ requestedCheckId: "token-at-upgrade", toolResultRef: "token-at-upgrade", outcome: "passed" }],
    });
    expect(result.evidence[0].upgradeInvestigation.checks.map(({ id }) => id)).toEqual(config.plans.approved.selectedChecks);
    expect(reader.reads).toHaveLength(6);
    expect(result.evidence[0].investigationReceipt?.receiptId).toBe(baseline.evidence[0].investigationReceipt?.receiptId);
    expect(result.evidence[0].investigationReceipt).not.toHaveProperty("narrative");
    expect(logEvents).toEqual([
      "agent-start",
      "agent-step",
      "agent-tool-selected",
      "agent-tool-complete",
      "agent-step",
      "agent-complete",
    ]);
  });

  it("runs two registered checks before finishing and completes the remaining plan deterministically", async () => {
    const provider: InvestigationAgentProvider = {
      provider: "openrouter",
      model: "test/model",
      decide: async (input) => input.step === 1
        ? {
          action: "run_check",
          checkId: "endpoint-at-upgrade",
          rationale: "Check the registered endpoint result.",
          narrative: "The endpoint check is ready for review.",
          uncertainty: "The token identity check remains.",
        }
        : input.step === 2
          ? {
            action: "run_check",
            checkId: "token-at-upgrade",
            rationale: "Check the registered token identity.",
            narrative: "The token identity check is ready for review.",
            uncertainty: "The final deterministic check remains.",
          }
          : {
            action: "finish",
            rationale: "The selected checks are sufficient.",
            narrative: "The deterministic plan will complete the remaining check.",
            uncertainty: "This result covers only the configured historical upgrade.",
          },
    };
    const providerInputs: AgentDecisionInput[] = [];
    const recordingProvider: InvestigationAgentProvider = {
      ...provider,
      decide: async (input) => {
        providerInputs.push(input);
        return provider.decide(input);
      },
    };
    const reader = new EtherfiFixtureReader();
    const baseline = await scanApprovedRange(new EtherfiFixtureReader(), config);
    const result = await scanApprovedRange(reader, config, {}, {
      agent: { providerName: "openrouter", model: recordingProvider.model, provider: recordingProvider },
    });

    expect(providerInputs).toHaveLength(3);
    expect(providerInputs[2]?.availableCheckIds).toEqual(["shared-decimals-at-upgrade"]);
    expect(result.evidence[0].agentInvestigation).toMatchObject({
      status: "complete",
      steps: [
        { step: 1, requestedCheckId: "endpoint-at-upgrade" },
        { step: 2, requestedCheckId: "token-at-upgrade" },
      ],
    });
    expect(reader.reads).toHaveLength(6);
    expect(result.evidence[0].upgradeInvestigation.checks.map(({ id }) => id)).toEqual(config.plans.approved.selectedChecks);
    expect(result.evidence[0].investigationReceipt?.receiptId).toBe(baseline.evidence[0].investigationReceipt?.receiptId);
  });

  it("surfaces unavailable and failed agents without changing deterministic output", async () => {
    const baseline = await scanApprovedRange(new EtherfiFixtureReader(), config);
    const unavailable = await scanApprovedRange(new EtherfiFixtureReader(), config, {}, {
      agent: { providerName: "openrouter", model: "test/model", provider: null },
    });
    const failingProvider: InvestigationAgentProvider = {
      provider: "openrouter",
      model: "test/model",
      decide: async () => { throw new AgentProviderError("Provider unavailable.", "provider"); },
    };
    const failed = await scanApprovedRange(new EtherfiFixtureReader(), config, {}, {
      agent: { providerName: "openrouter", model: failingProvider.model, provider: failingProvider },
    });

    expect(unavailable.evidence[0].agentInvestigation).toMatchObject({ status: "unavailable", failure: { category: "unavailable" } });
    expect(failed.evidence[0].agentInvestigation).toMatchObject({ status: "failed", failure: { category: "provider" } });
    expect(unavailable.evidence[0].upgradeInvestigation.checks).toHaveLength(6);
    expect(failed.evidence[0].upgradeInvestigation.checks).toHaveLength(6);
    expect(unavailable.evidence[0].investigationReceipt?.receiptId).toBe(baseline.evidence[0].investigationReceipt?.receiptId);
    expect(failed.evidence[0].investigationReceipt?.receiptId).toBe(unavailable.evidence[0].investigationReceipt?.receiptId);
  });

  it.each([
    ["timeout", new AgentProviderError("Provider timed out.", "timeout")],
    ["malformed output", new AgentProviderError("Provider output was invalid.", "invalid-output")],
  ])("fails safely for agent %s and still completes required checks", async (_label, providerError) => {
    const provider: InvestigationAgentProvider = {
      provider: "openrouter",
      model: "test/model",
      decide: async () => { throw providerError; },
    };
    const result = await scanApprovedRange(new EtherfiFixtureReader(), config, {}, {
      agent: { providerName: "openrouter", model: provider.model, provider },
    });

    expect(result.evidence[0].agentInvestigation).toMatchObject({
      status: "failed",
      failure: { category: providerError.category === "timeout" ? "timeout" : "invalid-output" },
    });
    expect(result.evidence[0].upgradeInvestigation.checks).toHaveLength(6);
    expect(result.evidence[0].upgradeInvestigation.disposition).toBe("corroborated");
  });

  it("rejects an agent check outside the selected plan and runs the deterministic fallback", async () => {
    const provider: InvestigationAgentProvider = {
      provider: "openrouter",
      model: "test/model",
      decide: async () => ({
        action: "run_check",
        checkId: "configured-pool",
        rationale: "Attempt a cross-profile check.",
        narrative: "No conclusion is available.",
        uncertainty: "The request is outside this profile.",
      }),
    };
    const result = await scanApprovedRange(new EtherfiFixtureReader(), config, {}, {
      agent: { providerName: "openrouter", model: provider.model, provider },
    });

    expect(result.evidence[0].agentInvestigation).toMatchObject({ status: "failed", failure: { category: "invalid-tool" } });
    expect(result.evidence[0].upgradeInvestigation.checks.map(({ id }) => id)).toEqual(config.plans.approved.selectedChecks);
  });

  it("fails safely when a provider requests a tool on the final decision", async () => {
    const requested = ["endpoint-at-upgrade", "token-at-upgrade", "shared-decimals-at-upgrade"] as const;
    let decisionCount = 0;
    const inputs: AgentDecisionInput[] = [];
    const logEvents: Array<{ event: string; step?: number }> = [];
    const provider: InvestigationAgentProvider = {
      provider: "openrouter",
      model: "test/model",
      decide: async (input) => {
        inputs.push(input);
        const checkId = requested[decisionCount];
        decisionCount += 1;
        return {
          action: "run_check",
          checkId,
          rationale: `Run registered follow-up check ${checkId}.`,
          narrative: "The bounded follow-up is still in progress.",
          uncertainty: "The deterministic result is not yet finalized.",
        };
      },
    };
    const reader = new EtherfiFixtureReader();
    const baseline = await scanApprovedRange(new EtherfiFixtureReader(), config);
    const result = await scanApprovedRange(reader, config, {}, {
      agent: {
        providerName: "openrouter",
        model: provider.model,
        provider,
        log: (event) => logEvents.push(event),
      },
    });

    expect(decisionCount).toBe(3);
    expect(inputs[2]?.step).toBe(3);
    expect(result.evidence[0].agentInvestigation).toMatchObject({
      status: "failed",
      steps: requested.slice(0, 2).map((requestedCheckId, index) => ({ step: index + 1, requestedCheckId })),
      failure: { code: "agent-step-limit", category: "step-limit" },
    });
    expect(logEvents.some(({ event, step }) => event === "agent-tool-selected" && step === 3)).toBe(false);
    expect(reader.reads).toHaveLength(6);
    expect(result.evidence[0].upgradeInvestigation.checks.map(({ id }) => id)).toEqual(config.plans.approved.selectedChecks);
    expect(result.evidence[0].upgradeInvestigation.disposition).toBe("corroborated");
    expect(result.evidence[0].investigationReceipt?.receiptId).toBe(baseline.evidence[0].investigationReceipt?.receiptId);
  });

  it("produces a contradicted investigation when endpoint() at N conflicts", async () => {
    const reader = new EtherfiFixtureReader();
    reader.endpointAtUpgrade = "0x0000000000000000000000001111111111111111111111111111111111111111";

    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("complete");
    expect(result.evidence[0].upgradeInvestigation).toMatchObject({
      disposition: "contradicted",
      evidenceStatus: "complete",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "endpoint-at-upgrade", status: "mismatch" }),
      ]),
    });
    expect(result.evidence[0].investigationReceipt?.finalDisposition).toBe("contradicted");
  });

  it.each([
    ["pruned archive history", "unsupported"],
    ["request timeout", "timeout"],
    ["provider rate limit", "rate-limit"],
  ] as const)("produces incomplete evidence for %s", async (_label, category) => {
    const reader = new EtherfiFixtureReader();
    reader.failedCall = { data: "0xfc0c546a", category };

    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.evidence[0].upgradeInvestigation).toMatchObject({
      disposition: "incomplete",
      evidenceStatus: "incomplete",
    });
    expect(result.evidence[0].upgradeInvestigation?.checks.find(({ id }) => id === "token-at-upgrade")).toMatchObject({
      id: "token-at-upgrade",
      status: category === "unsupported" ? "unsupported" : "failed",
      failure: { category },
    });
    expect(result.evidence[0].investigationReceipt?.finalDisposition).toBe("incomplete");
  });

  it("classifies common pruned-history provider errors as unsupported historical evidence", () => {
    expect(classifyRpcError(new Error("missing trie node for requested historical state"))).toBe("unsupported");
  });
});
