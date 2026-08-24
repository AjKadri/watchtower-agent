import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ChainBlock, ChainLog, ChainReader, ChainReceipt, ChainTransaction, Hex, LogFilter } from "../src/chain/types.js";
import { getTargetProfile } from "../src/profiles/registry.js";
import { createApp } from "../src/server/app.js";
import { readJson } from "./helpers.js";

type FixtureBlock = { number: string; hash: `0x${string}`; timestamp: string };
type FixtureTransaction = { hash: `0x${string}`; from: `0x${string}`; to: `0x${string}` };
type FixtureReceipt = {
  transactionHash: `0x${string}`;
  status: "success";
  selectedLogs: Array<{
    address: `0x${string}`;
    data: `0x${string}`;
    logIndex: string;
    topics: [`0x${string}`, ...`0x${string}`[]];
  }>;
};
type InvestigationFixture = {
  previousBlock: string;
  implementationBeforeWord: Hex;
  implementationAtUpgradeWord: Hex;
  implementationByteLength: string;
  getPoolResult: Hex;
  poolRevisionBeforeResult: Hex;
  poolRevisionAtUpgradeResult: Hex;
};

const fixtureRoot = "../fixtures/base/aave-v3-upgrade-41105890/";
const config = getTargetProfile("aave-v3-base-core");
const block = readJson<FixtureBlock>(`${fixtureRoot}block.json`, import.meta.url);
const transaction = readJson<FixtureTransaction>(`${fixtureRoot}transaction.json`, import.meta.url);
const receipt = readJson<FixtureReceipt>(`${fixtureRoot}receipt.json`, import.meta.url);
const investigationFixture = readJson<InvestigationFixture>(`${fixtureRoot}investigation.json`, import.meta.url);
const log: ChainLog = {
  ...receipt.selectedLogs[0],
  blockHash: block.hash,
  blockNumber: BigInt(block.number),
  logIndex: Number(receipt.selectedLogs[0].logIndex),
  transactionHash: receipt.transactionHash,
  transactionIndex: 122,
};

class ApiFixtureReader implements ChainReader {
  filters: LogFilter[] = [];
  failLogs = false;
  failBlock = false;

  async getChainId(): Promise<number> { return 8453; }
  async getLatestBlockNumber(): Promise<bigint> { return 50_000_000n; }
  async getLogs(filter: LogFilter) {
    this.filters.push(filter);
    if (this.failLogs) throw new Error("fixture failure");
    return { logs: [log], malformed: [] };
  }
  async getBlock(): Promise<ChainBlock> {
    if (this.failBlock) throw new Error("fixture block failure");
    return { hash: block.hash, number: BigInt(block.number), timestamp: BigInt(Date.parse(block.timestamp) / 1_000) };
  }
  async getTransaction(): Promise<ChainTransaction> { return transaction; }
  async getTransactionReceipt(): Promise<ChainReceipt> {
    return { transactionHash: receipt.transactionHash, status: receipt.status, logs: [log] };
  }
  async getStorageAt(_address: `0x${string}`, _slot: Hex, blockNumber: bigint): Promise<Hex> {
    return blockNumber === BigInt(investigationFixture.previousBlock)
      ? investigationFixture.implementationBeforeWord
      : investigationFixture.implementationAtUpgradeWord;
  }
  async getCode(): Promise<Hex> {
    return `0x${"60".repeat(Number(investigationFixture.implementationByteLength))}`;
  }
  async call(_address: `0x${string}`, data: Hex, blockNumber: bigint): Promise<Hex> {
    if (data === "0x026b1d5f") return investigationFixture.getPoolResult;
    return blockNumber === BigInt(investigationFixture.previousBlock)
      ? investigationFixture.poolRevisionBeforeResult
      : investigationFixture.poolRevisionAtUpgradeResult;
  }
}

const servers: Server[] = [];

async function serve(reader: ChainReader): Promise<string> {
  const server = createServer(createApp({ reader, config }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("Watchtower API", () => {
  it("serves health, sanitized configuration, and the dashboard", async () => {
    const baseUrl = await serve(new ApiFixtureReader());
    const health = await fetch(`${baseUrl}/api/health`);
    const publicConfig = await fetch(`${baseUrl}/api/config`);
    const dashboard = await fetch(baseUrl);

    expect(await health.json()).toEqual({ status: "ok", network: "base-mainnet", targetId: "aave-v3-base-core" });
    expect(health.headers.get("x-powered-by")).toBeNull();
    expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");
    const configuration = await publicConfig.json();
    const configurationText = JSON.stringify(configuration);
    expect(configurationText).toContain("Upgraded(address)");
    expect(configuration.detector).toMatchObject({
      incidentClass: "contract_upgrade",
      eventType: "proxy_upgraded",
      classificationLabel: "Contract upgrade",
    });
    expect(configurationText).not.toContain("BASE_RPC_URL");
    expect(configurationText).not.toContain("PoolUpdated");
    const dashboardText = await dashboard.text();
    expect(dashboardText).toContain("Watchtower");
    expect(dashboardText).toContain("MULTI-PROFILE INVESTIGATION ARCHIVE");
    expect(dashboardText).toContain("VERIFIED FIXTURES");
    expect(dashboardText).toContain("profile-selector");
  });

  it("runs and stores the approved scan, alerts, evidence, and investigation", async () => {
    const reader = new ApiFixtureReader();
    const baseUrl = await serve(reader);
    const scanResponse = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const scan = await scanResponse.json();

    expect(scanResponse.status).toBe(201);
    expect(scan).toMatchObject({
      status: "complete",
      failures: [],
      alerts: [{ severity: "informational", classificationLabel: "Contract upgrade" }],
    });
    expect(reader.filters).toEqual([{
      address: config.target.primaryContract.address,
      topic0: config.detectors[0].topic0,
      fromBlock: 41_105_890n,
      toBlock: 41_105_890n,
    }]);

    const storedScan = await fetch(`${baseUrl}/api/scans/${scan.scanId}`);
    const alertsResponse = await fetch(`${baseUrl}/api/alerts`);
    const alerts = await alertsResponse.json();
    const detailResponse = await fetch(`${baseUrl}/api/alerts/${scan.alerts[0].id}`);
    const detail = await detailResponse.json();
    const receiptId = scan.evidence[0].investigationReceipt.receiptId;
    const receiptResponse = await fetch(`${baseUrl}/api/receipts/${receiptId}`);
    const downloadedReceipt = await receiptResponse.json();

    expect((await storedScan.json()).scanId).toBe(scan.scanId);
    expect(alerts.alerts).toHaveLength(1);
    expect(detail.alert.investigation).toMatchObject({
      observedFacts: expect.arrayContaining([expect.stringContaining("emitted Upgraded(address)")]),
      interpretation: { severityRuleId: "target-is-approved" },
      limitations: expect.arrayContaining([expect.stringContaining("does not establish identity")]),
    });
    expect(detail.evidence).toMatchObject({
      status: "complete",
      block: { number: "41105890" },
      transaction: { hash: transaction.hash, receiptStatus: "success" },
      event: { decodedArguments: { implementation: "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4" } },
      upgradeInvestigation: {
        plan: { id: "corroborate-approved-upgrade", version: "1.0.0" },
        disposition: "corroborated",
      },
      investigationReceipt: { receiptId, finalDisposition: "corroborated" },
    });
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.headers.get("content-type")).toContain("application/json");
    expect(receiptResponse.headers.get("content-disposition")).toBe(`attachment; filename="watchtower-${receiptId}.json"`);
    expect(receiptResponse.headers.get("cache-control")).toBe("no-store");
    expect(downloadedReceipt).toEqual(scan.evidence[0].investigationReceipt);
    expect(JSON.stringify(downloadedReceipt)).not.toContain("BASE_RPC_URL");
  });

  it("validates scan, alert, and receipt identifiers before lookup", async () => {
    const baseUrl = await serve(new ApiFixtureReader());

    const invalidScan = await fetch(`${baseUrl}/api/scans/not-a-scan`);
    const invalidAlert = await fetch(`${baseUrl}/api/alerts/not-an-alert`);
    const invalidReceipt = await fetch(`${baseUrl}/api/receipts/not-a-receipt`);
    expect(invalidScan.status).toBe(400);
    expect(await invalidScan.json()).toMatchObject({ error: { code: "invalid-scan-id" } });
    expect(invalidAlert.status).toBe(400);
    expect(await invalidAlert.json()).toMatchObject({ error: { code: "invalid-alert-id" } });
    expect(invalidReceipt.status).toBe(400);
    expect(await invalidReceipt.json()).toMatchObject({ error: { code: "invalid-receipt-id" } });

    const missingScan = await fetch(`${baseUrl}/api/scans/scan_${"0".repeat(64)}`);
    const missingReceipt = await fetch(`${baseUrl}/api/receipts/receipt_${"0".repeat(64)}`);
    expect(missingScan.status).toBe(404);
    expect(await missingScan.json()).toMatchObject({ error: { code: "scan-not-found" } });
    expect(missingReceipt.status).toBe(404);
    expect(await missingReceipt.json()).toMatchObject({ error: { code: "receipt-not-found" } });
  });

  it("rejects scope expansion and returns scan failures visibly", async () => {
    const reader = new ApiFixtureReader();
    const baseUrl = await serve(reader);
    const invalid = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: "compound-iii-base-usdc-comet",
        address: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(reader.filters).toHaveLength(0);

    reader.failLogs = true;
    const failed = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const result = await failed.json();
    expect(failed.status).toBe(201);
    expect(result).toMatchObject({
      status: "failed",
      alerts: [],
      failures: [{ code: "log-chunk-rpc-failed", stage: "rpc" }],
    });
  });

  it("enforces the JSON scan-request contract and body limit", async () => {
    const reader = new ApiFixtureReader();
    const baseUrl = await serve(reader);

    const missingType = await fetch(`${baseUrl}/api/scans`, { method: "POST" });
    expect(missingType.status).toBe(415);
    expect(await missingType.json()).toMatchObject({ error: { code: "content-type-required" } });

    const unsupportedType = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(unsupportedType.status).toBe(415);
    expect(await unsupportedType.json()).toMatchObject({ error: { code: "content-type-required" } });

    const malformedJson = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformedJson.status).toBe(400);
    expect(await malformedJson.json()).toMatchObject({ error: { code: "invalid-json" } });

    for (const body of [null, [], "scan", { address: config.target.primaryContract.address }]) {
      const unsupported = await fetch(`${baseUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(unsupported.status).toBe(400);
      expect(await unsupported.json()).toMatchObject({ error: { code: "invalid-scan-request" } });
    }

    const tooLarge = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: { code: "request-body-too-large" } });
    expect(reader.filters).toHaveLength(0);
  });

  it("atomically replaces a successful scan with a failed rescan", async () => {
    const reader = new ApiFixtureReader();
    const baseUrl = await serve(reader);
    const successful = await (await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).json();
    const previousAlertId = successful.alerts[0].id;
    const previousReceiptId = successful.evidence[0].investigationReceipt.receiptId;

    reader.failLogs = true;
    const failedResponse = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const failed = await failedResponse.json();

    expect(failed.scanId).toBe(successful.scanId);
    expect(failed).toMatchObject({ status: "failed", alerts: [], evidence: [] });
    expect(await (await fetch(`${baseUrl}/api/scans/${failed.scanId}`)).json()).toMatchObject({ status: "failed" });
    expect(await (await fetch(`${baseUrl}/api/alerts`)).json()).toEqual({ alerts: [] });
    expect((await fetch(`${baseUrl}/api/alerts/${previousAlertId}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/receipts/${previousReceiptId}`)).status).toBe(404);
  });

  it("removes a stale receipt after a partial rescan", async () => {
    const reader = new ApiFixtureReader();
    const baseUrl = await serve(reader);
    const successful = await (await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).json();
    const previousReceiptId = successful.evidence[0].investigationReceipt.receiptId;

    reader.failBlock = true;
    const partialResponse = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const partial = await partialResponse.json();

    expect(partial).toMatchObject({
      scanId: successful.scanId,
      status: "partial",
      evidence: [{ investigationReceipt: null }],
    });
    expect((await fetch(`${baseUrl}/api/receipts/${previousReceiptId}`)).status).toBe(404);
  });
});
