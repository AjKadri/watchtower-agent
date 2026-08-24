import { describe, expect, it } from "vitest";

import { RpcReadError, type RpcFailureCategory } from "../src/chain/errors.js";
import type {
  ChainBlock,
  ChainLog,
  ChainReader,
  ChainReceipt,
  ChainTransaction,
  Hex,
  LogFilter,
  MalformedChainLog,
} from "../src/chain/types.js";
import { targetConfigSchema } from "../src/config/schema.js";
import { investigationReceiptSchema } from "../src/domain/schemas.js";
import { scanApprovedRange } from "../src/pipeline/scanner.js";
import { readJson } from "./helpers.js";

type FixtureBlock = { number: string; hash: `0x${string}`; timestamp: string };
type FixtureReceipt = {
  transactionHash: `0x${string}`;
  status: "success";
  selectedLogs: Array<{
    address: `0x${string}`;
    blockHash?: `0x${string}`;
    data: `0x${string}`;
    logIndex: string;
    topics: [`0x${string}`, ...`0x${string}`[]];
  }>;
};
type FixtureTransaction = {
  hash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
};
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
const config = targetConfigSchema.parse(readJson("../config/target.json", import.meta.url));
const fixtureBlock = readJson<FixtureBlock>(`${fixtureRoot}block.json`, import.meta.url);
const fixtureReceipt = readJson<FixtureReceipt>(`${fixtureRoot}receipt.json`, import.meta.url);
const fixtureTransaction = readJson<FixtureTransaction>(`${fixtureRoot}transaction.json`, import.meta.url);
const investigationFixture = readJson<InvestigationFixture>(`${fixtureRoot}investigation.json`, import.meta.url);

const fixtureLog: ChainLog = {
  ...fixtureReceipt.selectedLogs[0],
  blockHash: fixtureBlock.hash,
  blockNumber: BigInt(fixtureBlock.number),
  logIndex: Number(fixtureReceipt.selectedLogs[0].logIndex),
  transactionHash: fixtureReceipt.transactionHash,
  transactionIndex: 122,
};

class FixtureReader implements ChainReader {
  chainId = 8453;
  filters: LogFilter[] = [];
  logs: ChainLog[] = [fixtureLog];
  receiptLogs: ChainLog[] = [fixtureLog];
  malformedLogs: MalformedChainLog[] = [];
  blockError = false;
  logsError: false | true | Error = false;
  revisionError: Error | null = null;
  storageAtUpgradeError: Error | null = null;
  storageAtUpgrade = investigationFixture.implementationAtUpgradeWord;
  poolResult = investigationFixture.getPoolResult;
  evidenceCalls = { block: 0, transaction: 0, receipt: 0 };

  async getChainId(): Promise<number> {
    return this.chainId;
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return 50_000_000n;
  }

  async getLogs(filter: LogFilter) {
    this.filters.push(filter);
    if (this.logsError) throw this.logsError instanceof Error ? this.logsError : new Error("fixture RPC failure");
    return { logs: this.logs, malformed: this.malformedLogs };
  }

  async getBlock(): Promise<ChainBlock> {
    this.evidenceCalls.block += 1;
    if (this.blockError) throw new Error("fixture block failure");
    return {
      hash: fixtureBlock.hash,
      number: BigInt(fixtureBlock.number),
      timestamp: BigInt(Date.parse(fixtureBlock.timestamp) / 1_000),
    };
  }

  async getTransaction(): Promise<ChainTransaction> {
    this.evidenceCalls.transaction += 1;
    return {
      hash: fixtureTransaction.hash,
      from: fixtureTransaction.from,
      to: fixtureTransaction.to,
    };
  }

  async getTransactionReceipt(): Promise<ChainReceipt> {
    this.evidenceCalls.receipt += 1;
    return { transactionHash: fixtureReceipt.transactionHash, status: fixtureReceipt.status, logs: this.receiptLogs };
  }

  async getStorageAt(_address: `0x${string}`, slot: Hex, blockNumber: bigint): Promise<Hex> {
    expect(slot).toBe(investigationFixture.implementationSlot);
    if (blockNumber === BigInt(investigationFixture.upgradeBlock) && this.storageAtUpgradeError) throw this.storageAtUpgradeError;
    return blockNumber === BigInt(investigationFixture.previousBlock)
      ? investigationFixture.implementationBeforeWord
      : this.storageAtUpgrade;
  }

  async getCode(): Promise<Hex> {
    return `0x${"60".repeat(Number(investigationFixture.implementationByteLength))}`;
  }

  async call(_address: `0x${string}`, data: Hex, blockNumber: bigint): Promise<Hex> {
    if (data === config.investigation.getPoolCallData) return this.poolResult;
    if (this.revisionError) throw this.revisionError;
    return blockNumber === BigInt(investigationFixture.previousBlock)
      ? investigationFixture.poolRevisionBeforeResult
      : investigationFixture.poolRevisionAtUpgradeResult;
  }
}

describe("bounded evidence scan", () => {
  it("builds one complete informational alert from the verified fixture", async () => {
    const reader = new FixtureReader();
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("complete");
    expect(result.failures).toEqual([]);
    expect(result.alerts).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      incidentClass: "contract_upgrade",
      eventType: "proxy_upgraded",
      classificationLabel: "Contract upgrade",
      severity: "informational",
      severityRuleId: "target-is-approved",
      evidenceStatus: "complete",
      observedAt: fixtureBlock.timestamp,
      investigation: {
        interpretation: {
          severityRuleId: "target-is-approved",
          text: expect.stringContaining("configured approved target list"),
        },
        limitations: [expect.stringContaining("does not establish identity")],
      },
    });
    expect(result.evidence[0].event).toEqual({
      signature: "Upgraded(address)",
      decodedArguments: { implementation: "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4" },
    });
    expect(result.evidence[0]).toMatchObject({
      transaction: {
        hash: fixtureTransaction.hash,
        sender: fixtureTransaction.from,
        recipient: fixtureTransaction.to,
        receiptStatus: "success",
      },
      log: { index: "641", emitter: fixtureLog.address },
      relevantAddresses: [
        { address: fixtureLog.address, role: "pool-proxy" },
        { address: "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4", role: "decoded-implementation" },
        { address: config.investigation.poolAddressesProvider, role: "pool-addresses-provider" },
      ],
      upgradeInvestigation: { disposition: "corroborated", evidenceStatus: "complete" },
      investigationReceipt: {
        receiptId: expect.stringMatching(/^receipt_[0-9a-f]{64}$/),
        schemaVersion: 1,
        finalDisposition: "corroborated",
        plan: { id: "corroborate-approved-upgrade", version: "1.0.0" },
        trigger: {
          network: { name: "base-mainnet", chainId: 8453 },
          targetId: "aave-v3-base-core",
          eventSignature: "Upgraded(address)",
          block: { number: "41105890", hash: fixtureBlock.hash, timestamp: fixtureBlock.timestamp },
          transaction: { hash: fixtureTransaction.hash, receiptStatus: "success" },
          log: { index: "641", emitter: config.target.primaryContract.address },
        },
      },
    });
    const receipt = result.evidence[0].investigationReceipt;
    expect(receipt).not.toBeNull();
    expect(investigationReceiptSchema.parse(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
    expect(reader.filters).toEqual([{
      address: config.target.primaryContract.address,
      topic0: config.detectors[0].topic0,
      fromBlock: 41_105_890n,
      toBlock: 41_105_890n,
    }]);
  });

  it("produces stable IDs and prevents duplicate alerts and evidence fetches", async () => {
    const duplicateReader = new FixtureReader();
    duplicateReader.logs = [fixtureLog, fixtureLog];
    const first = await scanApprovedRange(duplicateReader, config);
    const second = await scanApprovedRange(new FixtureReader(), config);

    expect(first.alerts).toHaveLength(1);
    expect(first.evidence).toHaveLength(1);
    expect(first.alerts[0].id).toBe(second.alerts[0].id);
    expect(first.scanId).toBe(second.scanId);
    expect(first.evidence[0].investigationReceipt).toEqual(second.evidence[0].investigationReceipt);
    expect(first.evidence[0].investigationReceipt?.receiptId).toBe(second.evidence[0].investigationReceipt?.receiptId);
    expect(duplicateReader.evidenceCalls).toEqual({ block: 1, transaction: 1, receipt: 1 });
  });

  it("surfaces strict decoding failures", async () => {
    const reader = new FixtureReader();
    reader.logs = [{ ...fixtureLog, topics: [fixtureLog.topics[0], "0x1234"] }];
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.alerts).toEqual([]);
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "strict-upgrade-decode-failed", stage: "decode" }));
  });

  it("preserves valid logs when the same RPC response contains a malformed log", async () => {
    const reader = new FixtureReader();
    reader.malformedLogs = [{
      code: "malformed-rpc-log",
      message: "Base RPC returned one malformed log. Other valid logs from the response were preserved.",
      blockNumber: config.scan.fromBlock,
    }];
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.alerts).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: "malformed-rpc-log",
      category: "malformed-response",
    }));
  });

  it.each([
    ["dns", "log-chunk-rpc-dns"],
    ["timeout", "log-chunk-rpc-timeout"],
    ["rate-limit", "log-chunk-rpc-rate-limit"],
    ["malformed-response", "log-chunk-rpc-malformed-response"],
  ] satisfies Array<[RpcFailureCategory, string]>) ("preserves the %s RPC failure category", async (category, code) => {
    const reader = new FixtureReader();
    reader.logsError = new RpcReadError("log request", category);
    const result = await scanApprovedRange(reader, config);

    expect(result).toMatchObject({
      status: "failed",
      failures: [{ code, stage: "rpc", category }],
    });
  });

  it("does not report complete when the known upgrade event is absent", async () => {
    const reader = new FixtureReader();
    reader.logs = [];
    const result = await scanApprovedRange(reader, config);

    expect(result).toMatchObject({
      status: "partial",
      alerts: [],
      evidence: [],
      failures: [{
        code: "known-upgrade-event-not-observed",
        stage: "evidence",
        transactionHash: config.scan.knownTransactions[0],
      }],
    });
  });

  it("does not report complete when logs omit the configured known transaction", async () => {
    const reader = new FixtureReader();
    reader.logs = [{
      ...fixtureLog,
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }];
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: "known-upgrade-event-not-observed",
      stage: "evidence",
      transactionHash: config.scan.knownTransactions[0],
    }));
  });

  it("does not report complete when known transaction evidence is incomplete", async () => {
    const reader = new FixtureReader();
    reader.receiptLogs = [];
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.alerts[0].evidenceStatus).toBe("incomplete");
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "receipt-log-missing", stage: "evidence" }));
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: "known-transaction-evidence-incomplete",
      stage: "evidence",
      category: "incomplete-evidence",
      transactionHash: config.scan.knownTransactions[0],
    }));
  });

  it("fails before scanning when the RPC chain ID is not Base mainnet", async () => {
    const reader = new FixtureReader();
    reader.chainId = 1;
    const result = await scanApprovedRange(reader, config);

    expect(result).toMatchObject({
      status: "failed",
      alerts: [],
      evidence: [],
      failures: [{ code: "rpc-chain-id-mismatch", stage: "rpc" }],
    });
    expect(reader.filters).toEqual([]);
    expect(result.failures[0].category).toBe("wrong-chain");
    expect(reader.evidenceCalls).toEqual({ block: 0, transaction: 0, receipt: 0 });
  });

  it("keeps an alert visible when evidence retrieval is incomplete", async () => {
    const reader = new FixtureReader();
    reader.blockError = true;
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.alerts[0]).toMatchObject({ evidenceStatus: "incomplete", observedAt: null });
    expect(result.alerts[0].investigation.limitations).toContain(
      "Some required evidence could not be retrieved or verified. Review the recorded evidence errors before relying on this alert.",
    );
    expect(result.evidence[0]).toMatchObject({
      status: "incomplete",
      block: { timestamp: null },
      errors: [{ code: "block-evidence-unavailable" }],
    });
    expect(result.failures).toContainEqual(expect.objectContaining({ code: "block-evidence-unavailable", stage: "evidence" }));
  });

  it("preserves optional historical call failures without changing severity or disposition", async () => {
    const reader = new FixtureReader();
    reader.revisionError = new RpcReadError("historical contract call", "unsupported");
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.alerts[0]).toMatchObject({ severity: "informational", evidenceStatus: "incomplete" });
    expect(result.evidence[0].upgradeInvestigation).toMatchObject({
      disposition: "corroborated",
      evidenceStatus: "incomplete",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "pool-revision-before", status: "unsupported" }),
        expect.objectContaining({ id: "pool-revision-at-upgrade", status: "unsupported" }),
      ]),
    });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pool-revision-before-unsupported", category: "unsupported" }),
      expect.objectContaining({ code: "pool-revision-at-upgrade-unsupported", category: "unsupported" }),
    ]));
  });

  it("records a contradicted receipt when a required slot assertion conflicts", async () => {
    const reader = new FixtureReader();
    reader.storageAtUpgrade = "0x0000000000000000000000001111111111111111111111111111111111111111";
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("complete");
    expect(result.evidence[0].investigationReceipt).toMatchObject({
      finalDisposition: "contradicted",
      errors: [],
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "implementation-at-upgrade", status: "mismatch" }),
      ]),
    });
  });

  it("records an incomplete receipt when a required historical read fails", async () => {
    const reader = new FixtureReader();
    reader.storageAtUpgradeError = new RpcReadError("historical storage request", "timeout");
    const result = await scanApprovedRange(reader, config);

    expect(result.status).toBe("partial");
    expect(result.evidence[0].investigationReceipt).toMatchObject({
      finalDisposition: "incomplete",
      errors: [expect.objectContaining({ code: "implementation-at-upgrade-timeout", category: "timeout" })],
    });
  });

  it("rejects a replay receipt with an arbitrary call address", async () => {
    const result = await scanApprovedRange(new FixtureReader(), config);
    const forged = structuredClone(result.evidence[0].investigationReceipt) as NonNullable<typeof result.evidence[0]["investigationReceipt"]>;
    const providerCheck = forged.checks.find(({ id }) => id === "configured-pool");
    if (!providerCheck) throw new Error("fixture receipt omitted the provider check");
    providerCheck.parameters.to = "0x1111111111111111111111111111111111111111";

    expect(investigationReceiptSchema.safeParse(forged).success).toBe(false);
  });

  it("returns a visible failed result for RPC and invalid-range failures", async () => {
    const rpcReader = new FixtureReader();
    rpcReader.logsError = true;
    const rpcResult = await scanApprovedRange(rpcReader, config);
    const rangeResult = await scanApprovedRange(new FixtureReader(), config, {
      fromBlock: 41_105_889n,
      toBlock: 41_105_890n,
    });

    expect(rpcResult).toMatchObject({ status: "failed", failures: [{ code: "log-chunk-rpc-failed", stage: "rpc" }] });
    expect(rangeResult).toMatchObject({ status: "failed", failures: [{ code: "range-outside-approved-bounds", stage: "validation" }] });
  });
});
