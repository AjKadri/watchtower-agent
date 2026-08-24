import { describe, expect, it } from "vitest";

import { getTargetProfile } from "../src/profiles/registry.js";
import { readJson } from "./helpers.js";

type Log = { logIndex: string; address: string; topics: string[]; data: string };
type Receipt = { transactionHash: string; blockNumber: string; blockHash: string; status: string; selectedLogs: Log[] };
type Block = { number: string; hash: string; timestamp: string };
type Transaction = { hash: string; from: string; to: string };
type ExpectedEvent = {
  detectorId: string;
  incidentClass: string;
  logIndex: string;
  emitter: string;
  decodedArguments: Record<string, string>;
  expectedSeverity: string;
  expectedSeverityRuleId: string;
};

function indexedAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

describe.each([
  ["Aave V3 Base Pool", "aave-v3-base-core", "../fixtures/base/aave-v3-upgrade-41105890/"],
  ["Compound III Base USDC Comet", "compound-iii-base-usdc-comet", "../fixtures/base/compound-iii-usdc-upgrade-40235590/"],
] as const)("verified %s fixture", (_label, profileId, fixtureRoot) => {
  const config = getTargetProfile(profileId);
  const block = readJson<Block>(`${fixtureRoot}block.json`, import.meta.url);
  const receipt = readJson<Receipt>(`${fixtureRoot}receipt.json`, import.meta.url);
  const transaction = readJson<Transaction>(`${fixtureRoot}transaction.json`, import.meta.url);
  const events = readJson<ExpectedEvent[]>(`${fixtureRoot}expected-events.json`, import.meta.url);

  it("keeps block and transaction identity consistent with the target", () => {
    expect(receipt.status).toBe("success");
    expect(receipt.blockNumber).toBe(block.number);
    expect(receipt.blockHash).toBe(block.hash);
    expect(config.scan.fromBlock).toBe(block.number);
    expect(config.scan.knownTransactions).toContain(receipt.transactionHash);
    expect(transaction.hash).toBe(receipt.transactionHash);
    expect(transaction.from).toMatch(/^0x[0-9a-f]{40}$/);
    expect(transaction.to).toMatch(/^0x[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(block.timestamp))).toBe(false);
  });

  it("maps every expected event to an approved detector and exact selected log", () => {
    for (const event of events) {
      const detector = config.detectors.find(({ id }) => id === event.detectorId);
      const log = receipt.selectedLogs.find(({ logIndex }) => logIndex === event.logIndex);

      expect(detector, event.detectorId).toBeDefined();
      expect(event.incidentClass).toBe("contract_upgrade");
      expect(event.incidentClass).toBe(detector?.incidentClass);
      expect(log, event.logIndex).toBeDefined();
      expect(log?.address.toLowerCase()).toBe(event.emitter.toLowerCase());
      expect(log?.topics[0]).toBe(detector?.topic0);
      expect(detector?.contractAddresses.map((value) => value.toLowerCase())).toContain(event.emitter.toLowerCase());
    }
  });

  it("uses the approved contract-upgrade incident class in every fixture event", () => {
    expect(events.map(({ incidentClass }) => incidentClass)).toEqual(["contract_upgrade"]);
  });

  it("decodes the indexed implementation without adding unsupported event types", () => {
    const upgradeLog = receipt.selectedLogs[0];

    expect(indexedAddress(upgradeLog.topics[1])).toBe(events[0].decodedArguments.implementation.toLowerCase());
    expect(receipt.selectedLogs.map(({ topics }) => topics[0])).toEqual(config.detectors.map(({ topic0 }) => topic0));
  });
});
