import { describe, expect, it } from "vitest";

import { RpcReadError, type RpcFailureCategory } from "../src/chain/errors.js";
import type {
  Address,
  ChainBlock,
  ChainLog,
  ChainReader,
  ChainReceipt,
  ChainTransaction,
  Hex,
  LogFilter,
  MalformedChainLog,
} from "../src/chain/types.js";
import { getTargetProfile } from "../src/profiles/registry.js";
import { evidenceSchema, investigationReceiptSchema, scanResultSchema, type Evidence, type InvestigationReceipt } from "../src/domain/schemas.js";
import { selectInvestigationPlan } from "../src/investigation/plans.js";
import { normalizeEvmAddress } from "../src/evm/address.js";
import { createReceiptId } from "../src/pipeline/ids.js";
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
const config = getTargetProfile("aave-v3-base-core");
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
    if (data === "0x026b1d5f") return this.poolResult;
    if (this.revisionError) throw this.revisionError;
    return blockNumber === BigInt(investigationFixture.previousBlock)
      ? investigationFixture.poolRevisionBeforeResult
      : investigationFixture.poolRevisionAtUpgradeResult;
  }
}

function rehashReceipt(receipt: InvestigationReceipt): void {
  receipt.receiptId = createReceiptId(receipt);
}

async function completeEvidence(): Promise<Evidence> {
  const result = await scanApprovedRange(new FixtureReader(), config);
  const evidence = result.evidence[0];
  if (!evidence?.investigationReceipt) throw new Error("fixture scan omitted the investigation receipt");
  return structuredClone(evidence);
}

describe("bounded evidence scan", () => {
  it("builds one complete real-shaped scan result that passes receipt validation", async () => {
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
        sender: normalizeEvmAddress(fixtureTransaction.from),
        recipient: normalizeEvmAddress(fixtureTransaction.to),
        receiptStatus: "success",
      },
      log: { index: "641", emitter: fixtureLog.address },
      relevantAddresses: [
        { address: fixtureLog.address, role: "pool-proxy" },
        { address: "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4", role: "decoded-implementation" },
        { address: config.target.relatedContracts[0].address, role: "pool-addresses-provider" },
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
    expect(scanResultSchema.safeParse(JSON.parse(JSON.stringify(result))).success).toBe(true);
    expect(reader.filters).toEqual([{
      address: config.target.primaryContract.address,
      topic0: config.detectors[0].topic0,
      fromBlock: 41_105_890n,
      toBlock: 41_105_890n,
    }]);
  });

  it("accepts a lowercase viem emitter against checksum configuration and receipt data", async () => {
    const reader = new FixtureReader();
    reader.logs = [{ ...fixtureLog, address: fixtureLog.address.toLowerCase() as Address }];

    const result = await scanApprovedRange(reader, config);

    expect(result).toMatchObject({
      status: "complete",
      alerts: [{ incidentClass: "contract_upgrade", evidenceStatus: "complete" }],
      evidence: [{ status: "complete", investigationReceipt: { finalDisposition: "corroborated" } }],
      failures: [],
    });
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

  it("rejects a forged receipt ID", async () => {
    const evidence = await completeEvidence();
    const forged = evidence.investigationReceipt as InvestigationReceipt;
    forged.receiptId = `receipt_${"0".repeat(64)}`;

    expect(investigationReceiptSchema.safeParse(forged).success).toBe(false);
  });

  it("keeps the canonical receipt hash stable across key order and repeated scans", async () => {
    const first = await completeEvidence();
    const second = await completeEvidence();
    const receipt = first.investigationReceipt as InvestigationReceipt;
    const reorderedPayload = {
      explorerLinks: receipt.explorerLinks,
      finalDisposition: receipt.finalDisposition,
      limitations: receipt.limitations,
      errors: receipt.errors,
      checks: receipt.checks,
      plan: receipt.plan,
      trigger: receipt.trigger,
      schemaVersion: receipt.schemaVersion,
    };

    expect(createReceiptId(reorderedPayload)).toBe(receipt.receiptId);
    expect(second.investigationReceipt?.receiptId).toBe(receipt.receiptId);
  });

  it("keeps the Aave receipt deterministic after adding other registry profiles", async () => {
    const first = await scanApprovedRange(new FixtureReader(), config);
    const second = await scanApprovedRange(new FixtureReader(), getTargetProfile("aave-v3-base-core"));

    expect(second.evidence[0].investigationReceipt?.receiptId).toBe(first.evidence[0].investigationReceipt?.receiptId);
    expect(second.evidence[0].investigationReceipt).toEqual(first.evidence[0].investigationReceipt);
  });

  it("keeps the canonical receipt ID stable across Ethereum address casing", async () => {
    const evidence = await completeEvidence();
    const receipt = evidence.investigationReceipt as InvestigationReceipt;
    const lowercaseAddresses = (value: unknown): unknown => {
      if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
      if (Array.isArray(value)) return value.map(lowercaseAddresses);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, lowercaseAddresses(item)]));
      }
      return value;
    };
    const lowercaseReceipt = lowercaseAddresses(receipt) as InvestigationReceipt;

    expect(createReceiptId(lowercaseReceipt)).toBe(receipt.receiptId);
    expect(investigationReceiptSchema.parse(lowercaseReceipt).receiptId).toBe(receipt.receiptId);
  });

  it.each([
    ["passed check with a false assertion", (receipt: InvestigationReceipt) => {
      receipt.checks[0].assertion.matches = false;
    }],
    ["passed check with a null result", (receipt: InvestigationReceipt) => {
      receipt.checks[0].result = null;
    }],
    ["passed check with failure details", (receipt: InvestigationReceipt) => {
      const failure = { code: "synthetic-timeout", category: "timeout" as const, message: "Synthetic safe test failure." };
      receipt.checks[0].failure = failure;
      receipt.errors = [failure];
    }],
    ["failed check without failure details", (receipt: InvestigationReceipt) => {
      const check = receipt.checks[0];
      check.status = "failed";
      check.result = null;
      check.assertion.actual = null;
      check.assertion.matches = null;
      check.failure = null;
      receipt.finalDisposition = "incomplete";
    }],
    ["assertion actual that differs from its result", (receipt: InvestigationReceipt) => {
      receipt.checks[0].assertion.actual = "0x1111111111111111111111111111111111111111";
    }],
    ["final disposition that conflicts with required checks", (receipt: InvestigationReceipt) => {
      receipt.finalDisposition = "contradicted";
    }],
  ])("rejects a receipt containing a %s", async (_case, mutate) => {
    const evidence = await completeEvidence();
    const receipt = evidence.investigationReceipt as InvestigationReceipt;
    mutate(receipt);
    rehashReceipt(receipt);

    expect(investigationReceiptSchema.safeParse(receipt).success).toBe(false);
  });

  it.each([
    ["trigger", (evidence: Evidence) => {
      const receipt = evidence.investigationReceipt as InvestigationReceipt;
      receipt.trigger.transaction.sender = "0x1111111111111111111111111111111111111111";
      rehashReceipt(receipt);
    }],
    ["plan", (evidence: Evidence) => {
      evidence.upgradeInvestigation.plan = selectInvestigationPlan({
        targetId: "aave-v3-base-core",
        eventSignature: "Upgraded(address)",
        triggerEvidenceStatus: "complete",
        severityRuleId: "target-is-not-approved",
      });
    }],
    ["checks", (evidence: Evidence) => {
      evidence.upgradeInvestigation.checks[0].assertion.description = "A different containing investigation check.";
    }],
    ["disposition", (evidence: Evidence) => {
      evidence.upgradeInvestigation.disposition = "contradicted";
    }],
    ["explorer links", (evidence: Evidence) => {
      evidence.sources.transaction = `https://basescan.org/tx/${"1".repeat(64)}`;
    }],
  ])("rejects receipt %s fields that disagree with containing evidence or investigation", async (_field, mutate) => {
    const evidence = await completeEvidence();
    mutate(evidence);

    expect(evidenceSchema.safeParse(evidence).success).toBe(false);
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
