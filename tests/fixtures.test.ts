import { describe, expect, it } from "vitest";

import { targetConfigSchema } from "../src/config/schema.js";
import { readJson } from "./helpers.js";

type Log = { logIndex: string; address: string; topics: string[]; data: string };
type Receipt = { transactionHash: string; blockNumber: string; blockHash: string; status: string; selectedLogs: Log[] };
type Block = { number: string; hash: string; timestamp: string };
type ExpectedEvent = {
  detectorId: string;
  logIndex: string;
  emitter: string;
  decodedArguments: Record<string, string>;
  expectedSeverity: string;
  expectedSeverityRuleId: string;
};

const fixtureRoot = "../fixtures/base/aave-v3-upgrade-41105890/";
const config = targetConfigSchema.parse(readJson("../config/target.json", import.meta.url));
const block = readJson<Block>(`${fixtureRoot}block.json`, import.meta.url);
const receipt = readJson<Receipt>(`${fixtureRoot}receipt.json`, import.meta.url);
const events = readJson<ExpectedEvent[]>(`${fixtureRoot}expected-events.json`, import.meta.url);

function indexedAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

describe("verified Base fixture", () => {
  it("keeps block and transaction identity consistent with the target", () => {
    expect(receipt.status).toBe("success");
    expect(receipt.blockNumber).toBe(block.number);
    expect(receipt.blockHash).toBe(block.hash);
    expect(config.scan.fromBlock).toBe(block.number);
    expect(config.scan.knownTransactions).toContain(receipt.transactionHash);
    expect(Number.isNaN(Date.parse(block.timestamp))).toBe(false);
  });

  it("maps every expected event to an approved detector and exact selected log", () => {
    for (const event of events) {
      const detector = config.detectors.find(({ id }) => id === event.detectorId);
      const log = receipt.selectedLogs.find(({ logIndex }) => logIndex === event.logIndex);

      expect(detector, event.detectorId).toBeDefined();
      expect(log, event.logIndex).toBeDefined();
      expect(log?.address.toLowerCase()).toBe(event.emitter.toLowerCase());
      expect(log?.topics[0]).toBe(detector?.topic0);
      expect(detector?.contractAddresses.map((value) => value.toLowerCase())).toContain(event.emitter.toLowerCase());
    }
  });

  it("decodes the indexed target addresses without adding unsupported event types", () => {
    const upgradeLog = receipt.selectedLogs[0];
    const poolUpdateLog = receipt.selectedLogs[1];

    expect(indexedAddress(upgradeLog.topics[1])).toBe(events[0].decodedArguments.implementation.toLowerCase());
    expect(indexedAddress(poolUpdateLog.topics[1])).toBe(events[1].decodedArguments.oldAddress.toLowerCase());
    expect(indexedAddress(poolUpdateLog.topics[2])).toBe(events[1].decodedArguments.newAddress.toLowerCase());
    expect(receipt.selectedLogs.map(({ topics }) => topics[0])).toEqual(config.detectors.map(({ topic0 }) => topic0));
  });
});
