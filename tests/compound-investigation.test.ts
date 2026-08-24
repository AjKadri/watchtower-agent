import { describe, expect, it } from "vitest";

import { RpcReadError } from "../src/chain/errors.js";
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
import { getTargetProfile } from "../src/profiles/registry.js";
import { scanApprovedRange } from "../src/pipeline/scanner.js";
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
  governorBeforeResult: Hex;
  governorAtUpgradeResult: Hex;
  baseTokenAtUpgradeResult: Hex;
};

const fixtureRoot = "../fixtures/base/compound-iii-usdc-upgrade-40235590/";
const config = getTargetProfile("compound-iii-base-usdc-comet");
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

class CompoundFixtureReader implements ChainReader {
  governorAtUpgrade = investigation.governorAtUpgradeResult;
  failBaseToken: Error | null = null;
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
    if (data === "0xc55dae63") {
      if (this.failBaseToken) throw this.failBaseToken;
      return investigation.baseTokenAtUpgradeResult;
    }
    return blockNumber === BigInt(investigation.previousBlock)
      ? investigation.governorBeforeResult
      : this.governorAtUpgrade;
  }
}

describe("Compound III Base USDC Comet investigation profile", () => {
  it("produces a complete corroborated investigation using only the six fixed historical reads", async () => {
    const reader = new CompoundFixtureReader();
    const result = await scanApprovedRange(reader, config);

    expect(result).toMatchObject({
      status: "complete",
      targetId: "compound-iii-base-usdc-comet",
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
      "governor-before",
      "governor-at-upgrade",
      "base-token-at-upgrade",
    ]);
    expect(reader.reads).toHaveLength(6);
    expect(reader.reads.every(({ address }) => address === config.target.primaryContract.address
      || address === config.expectedFixture.implementationAfter)).toBe(true);
    expect(reader.reads.every(({ blockNumber }) => blockNumber === BigInt(investigation.previousBlock)
      || blockNumber === BigInt(investigation.upgradeBlock))).toBe(true);
    expect(investigationReceiptSchema.safeParse(result.evidence[0].investigationReceipt).success).toBe(true);
  });

  it("produces a contradicted investigation when governor() at N conflicts", async () => {
    const reader = new CompoundFixtureReader();
    reader.governorAtUpgrade = "0x0000000000000000000000001111111111111111111111111111111111111111";

    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("complete");
    expect(result.evidence[0].upgradeInvestigation).toMatchObject({
      disposition: "contradicted",
      evidenceStatus: "complete",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "governor-at-upgrade", status: "mismatch" }),
      ]),
    });
    expect(result.evidence[0].investigationReceipt?.finalDisposition).toBe("contradicted");
  });

  it("produces an incomplete investigation when historical baseToken() cannot be read", async () => {
    const reader = new CompoundFixtureReader();
    reader.failBaseToken = new RpcReadError("historical contract call", "timeout");

    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.evidence[0].upgradeInvestigation).toMatchObject({
      disposition: "incomplete",
      evidenceStatus: "incomplete",
    });
    expect(result.evidence[0].upgradeInvestigation?.checks.find(({ id }) => id === "base-token-at-upgrade")).toMatchObject({
      id: "base-token-at-upgrade",
      status: "failed",
      failure: { category: "timeout" },
    });
    expect(result.evidence[0].investigationReceipt?.finalDisposition).toBe("incomplete");
  });
});
