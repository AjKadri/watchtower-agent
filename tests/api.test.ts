import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ChainBlock, ChainLog, ChainReader, ChainReceipt, ChainTransaction, LogFilter } from "../src/chain/types.js";
import { targetConfigSchema } from "../src/config/schema.js";
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

const fixtureRoot = "../fixtures/base/aave-v3-upgrade-41105890/";
const config = targetConfigSchema.parse(readJson("../config/target.json", import.meta.url));
const block = readJson<FixtureBlock>(`${fixtureRoot}block.json`, import.meta.url);
const transaction = readJson<FixtureTransaction>(`${fixtureRoot}transaction.json`, import.meta.url);
const receipt = readJson<FixtureReceipt>(`${fixtureRoot}receipt.json`, import.meta.url);
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

  async getLatestBlockNumber(): Promise<bigint> { return 50_000_000n; }
  async getLogs(filter: LogFilter): Promise<ChainLog[]> {
    this.filters.push(filter);
    if (this.failLogs) throw new Error("fixture failure");
    return [log];
  }
  async getBlock(): Promise<ChainBlock> {
    return { hash: block.hash, number: BigInt(block.number), timestamp: BigInt(Date.parse(block.timestamp) / 1_000) };
  }
  async getTransaction(): Promise<ChainTransaction> { return transaction; }
  async getTransactionReceipt(): Promise<ChainReceipt> {
    return { transactionHash: receipt.transactionHash, status: receipt.status, logs: [log] };
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
    const configurationText = await publicConfig.text();
    expect(configurationText).toContain("Upgraded(address)");
    expect(configurationText).not.toContain("BASE_RPC_URL");
    expect(configurationText).not.toContain("PoolUpdated");
    const dashboardText = await dashboard.text();
    expect(dashboardText).toContain("WATCHTOWER");
    expect(dashboardText).toContain("INVESTIGATION CONSOLE");
    expect(dashboardText).toContain("RUN BOUNDED SCAN");
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
    expect(scan).toMatchObject({ status: "complete", failures: [], alerts: [{ severity: "informational" }] });
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
    });
  });

  it("rejects scope expansion and returns scan failures visibly", async () => {
    const reader = new ApiFixtureReader();
    const baseUrl = await serve(reader);
    const invalid = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }),
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
});
