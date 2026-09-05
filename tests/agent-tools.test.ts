import { describe, expect, it } from "vitest";

import { executeAgentTool } from "../src/agent/tools.js";
import type { Address, ChainBlock, ChainLogBatch, ChainReader, ChainReceipt, ChainTransaction, Hash, Hex, LogFilter } from "../src/chain/types.js";
import { RegisteredCheckExecutor } from "../src/investigation/checks.js";
import { getTargetProfile } from "../src/profiles/registry.js";

class ToolReader implements ChainReader {
  async getChainId(): Promise<number> { throw new Error("unused"); }
  async getLatestBlockNumber(): Promise<bigint> { throw new Error("unused"); }
  async getLogs(_filter: LogFilter): Promise<ChainLogBatch> { throw new Error("unused"); }
  async getBlock(_hash: Hash): Promise<ChainBlock> { throw new Error("unused"); }
  async getTransaction(_hash: Hash): Promise<ChainTransaction> { throw new Error("unused"); }
  async getTransactionReceipt(_hash: Hash): Promise<ChainReceipt> { throw new Error("unused"); }
  async getStorageAt(_address: Address, _slot: Hex, _block: bigint): Promise<Hex> {
    return "0x00000000000000000000000079ab8fc5ba13daf37b4e978a543286bc2a16508c";
  }
  async getCode(): Promise<Hex> { throw new Error("unused"); }
  async call(): Promise<Hex> { throw new Error("unused"); }
}

function executor() {
  const profile = getTargetProfile("aave-v3-base-core");
  return new RegisteredCheckExecutor(
    new ToolReader(),
    profile,
    profile.severityPolicy.approvedTargetAddresses[0],
    profile.plans.approved,
  );
}

describe("bounded agent tool boundary", () => {
  it("executes a registered plan check without accepting RPC parameters", async () => {
    const result = await executeAgentTool(executor(), {
      action: "run_check",
      checkId: "implementation-before",
      rationale: "Confirm the implementation changed across the approved historical boundary.",
      narrative: "The pre-upgrade state should be checked first.",
      uncertainty: "The remaining checks have not run yet.",
    });

    expect(result).toMatchObject({ id: "implementation-before", status: "passed" });
    expect(result.parameters).toHaveProperty("slot");
  });

  it.each([
    ["an extra address", { address: "0x1111111111111111111111111111111111111111" }],
    ["a block", { block: "1" }],
    ["calldata", { data: "0x1234" }],
    ["an RPC URL", { rpcUrl: "https://example.com" }],
    ["an expected value", { expected: "anything" }],
  ])("rejects %s supplied by the model", async (_label, extra) => {
    await expect(executeAgentTool(executor(), {
      action: "run_check",
      checkId: "implementation-before",
      rationale: "Inspect the registered check.",
      narrative: "A bounded check is requested.",
      uncertainty: "Other checks remain.",
      ...extra,
    })).rejects.toThrow();
  });

  it("rejects cross-profile and repeated check requests", async () => {
    const bounded = executor();
    const request = {
      action: "run_check",
      checkId: "implementation-before",
      rationale: "Inspect the registered check.",
      narrative: "A bounded check is requested.",
      uncertainty: "Other checks remain.",
    };
    await executeAgentTool(bounded, request);
    await expect(executeAgentTool(bounded, request)).rejects.toThrow(/unavailable|already/);
    await expect(executeAgentTool(bounded, { ...request, checkId: "endpoint-at-upgrade" })).rejects.toThrow(/outside|unavailable/);
  });
});
