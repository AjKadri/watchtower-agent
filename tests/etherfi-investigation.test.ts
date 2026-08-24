import { describe, expect, it } from "vitest";

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
