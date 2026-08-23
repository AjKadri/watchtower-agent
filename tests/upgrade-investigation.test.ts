import { describe, expect, it } from "vitest";

import { RpcReadError } from "../src/chain/errors.js";
import type {
  Address,
  ChainBlock,
  ChainLogBatch,
  ChainReader,
  ChainReceipt,
  ChainTransaction,
  Hash,
  Hex,
  LogFilter,
} from "../src/chain/types.js";
import { targetConfigSchema } from "../src/config/schema.js";
import { investigateApprovedUpgrade } from "../src/investigation/upgrade.js";
import { readJson } from "./helpers.js";

type InvestigationFixture = {
  previousBlock: string;
  upgradeBlock: string;
  implementationSlot: Hex;
  implementationBeforeWord: Hex;
  implementationAtUpgradeWord: Hex;
  implementationByteLength: string;
  getPoolResult: Hex;
  poolRevisionBeforeResult: Hex;
  poolRevisionAtUpgradeResult: Hex;
};

const fixtureRoot = "../fixtures/base/aave-v3-upgrade-41105890/";
const fixture = readJson<InvestigationFixture>(`${fixtureRoot}investigation.json`, import.meta.url);
const config = targetConfigSchema.parse(readJson("../config/target.json", import.meta.url));
const decodedImplementation = config.severityPolicy.approvedTargetAddresses[0];

class HistoricalFixtureReader implements ChainReader {
  storageBefore = fixture.implementationBeforeWord;
  storageAtUpgrade = fixture.implementationAtUpgradeWord;
  code = `0x${"60".repeat(Number(fixture.implementationByteLength))}` as Hex;
  poolResult = fixture.getPoolResult;
  revisionBefore = fixture.poolRevisionBeforeResult;
  revisionAtUpgrade = fixture.poolRevisionAtUpgradeResult;
  failStorageAtUpgrade: Error | null = null;
  revisionsUnsupported = false;
  reads: Array<{ method: string; address: Address; blockNumber: bigint; data?: Hex }> = [];

  async getChainId(): Promise<number> { throw new Error("unused"); }
  async getLatestBlockNumber(): Promise<bigint> { throw new Error("unused"); }
  async getLogs(_filter: LogFilter): Promise<ChainLogBatch> { throw new Error("unused"); }
  async getBlock(_blockHash: Hash): Promise<ChainBlock> { throw new Error("unused"); }
  async getTransaction(_transactionHash: Hash): Promise<ChainTransaction> { throw new Error("unused"); }
  async getTransactionReceipt(_transactionHash: Hash): Promise<ChainReceipt> { throw new Error("unused"); }

  async getStorageAt(address: Address, slot: Hex, blockNumber: bigint): Promise<Hex> {
    this.reads.push({ method: "eth_getStorageAt", address, blockNumber, data: slot });
    if (blockNumber === BigInt(fixture.upgradeBlock) && this.failStorageAtUpgrade) throw this.failStorageAtUpgrade;
    return blockNumber === BigInt(fixture.previousBlock) ? this.storageBefore : this.storageAtUpgrade;
  }

  async getCode(address: Address, blockNumber: bigint): Promise<Hex> {
    this.reads.push({ method: "eth_getCode", address, blockNumber });
    return this.code;
  }

  async call(address: Address, data: Hex, blockNumber: bigint): Promise<Hex> {
    this.reads.push({ method: "eth_call", address, blockNumber, data });
    if (data === config.investigation.getPoolCallData) return this.poolResult;
    if (this.revisionsUnsupported) throw new RpcReadError("historical contract call", "unsupported");
    return blockNumber === BigInt(fixture.previousBlock) ? this.revisionBefore : this.revisionAtUpgrade;
  }
}

describe("bounded upgrade investigation", () => {
  it("corroborates all fixture-backed checks with exact historical block tags", async () => {
    const reader = new HistoricalFixtureReader();
    const result = await investigateApprovedUpgrade(reader, config, decodedImplementation);

    expect(result).toMatchObject({ disposition: "corroborated", evidenceStatus: "complete" });
    expect(result.checks.map(({ id, method, blockTag, status }) => ({ id, method, blockTag, status }))).toEqual([
      { id: "implementation-before", method: "eth_getStorageAt", blockTag: "0x27339e1", status: "passed" },
      { id: "implementation-at-upgrade", method: "eth_getStorageAt", blockTag: "0x27339e2", status: "passed" },
      { id: "implementation-bytecode", method: "eth_getCode", blockTag: "0x27339e2", status: "passed" },
      { id: "configured-pool", method: "eth_call", blockTag: "0x27339e2", status: "passed" },
      { id: "pool-revision-before", method: "eth_call", blockTag: "0x27339e1", status: "passed" },
      { id: "pool-revision-at-upgrade", method: "eth_call", blockTag: "0x27339e2", status: "passed" },
    ]);
    expect(result.checks[0]).toMatchObject({
      parameters: { address: config.target.primaryContract.address, slot: fixture.implementationSlot },
      result: { kind: "address", value: config.investigation.expected.implementationBefore },
      assertion: { matches: true },
      failure: null,
    });
    expect(result.checks[2]).toMatchObject({
      parameters: { address: decodedImplementation },
      result: { kind: "bytecode", present: true, byteLength: fixture.implementationByteLength },
    });
    expect(reader.reads.every(({ blockNumber }) =>
      blockNumber === BigInt(fixture.previousBlock) || blockNumber === BigInt(fixture.upgradeBlock))).toBe(true);
  });

  it("marks a successful required read that conflicts with the fixture as contradicted", async () => {
    const reader = new HistoricalFixtureReader();
    reader.storageAtUpgrade = "0x0000000000000000000000001111111111111111111111111111111111111111";

    const result = await investigateApprovedUpgrade(reader, config, decodedImplementation);

    expect(result.disposition).toBe("contradicted");
    expect(result.evidenceStatus).toBe("complete");
    expect(result.checks.find(({ id }) => id === "implementation-at-upgrade")).toMatchObject({
      status: "mismatch",
      assertion: { matches: false },
      failure: null,
    });
  });

  it("keeps unsupported optional revisions incomplete without changing disposition", async () => {
    const reader = new HistoricalFixtureReader();
    reader.revisionsUnsupported = true;

    const result = await investigateApprovedUpgrade(reader, config, decodedImplementation);

    expect(result.disposition).toBe("corroborated");
    expect(result.evidenceStatus).toBe("incomplete");
    expect(result.checks.filter(({ required }) => !required)).toEqual([
      expect.objectContaining({ status: "unsupported", result: null, failure: expect.objectContaining({ category: "unsupported" }) }),
      expect.objectContaining({ status: "unsupported", result: null, failure: expect.objectContaining({ category: "unsupported" }) }),
    ]);
  });

  it("preserves a required historical RPC failure as an incomplete disposition", async () => {
    const reader = new HistoricalFixtureReader();
    reader.failStorageAtUpgrade = new RpcReadError("historical storage request", "timeout");

    const result = await investigateApprovedUpgrade(reader, config, decodedImplementation);

    expect(result.disposition).toBe("incomplete");
    expect(result.evidenceStatus).toBe("incomplete");
    expect(result.checks.find(({ id }) => id === "implementation-at-upgrade")).toMatchObject({
      status: "failed",
      result: null,
      assertion: { actual: null, matches: null },
      failure: {
        code: "implementation-at-upgrade-timeout",
        category: "timeout",
        message: expect.not.stringContaining("RPC"),
      },
    });
  });
});
