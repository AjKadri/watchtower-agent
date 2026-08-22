import { describe, expect, it } from "vitest";

import { targetConfigSchema } from "../src/config/schema.js";
import { readJson } from "./helpers.js";

const config = targetConfigSchema.parse(readJson("../config/target.json", import.meta.url));

describe("target configuration", () => {
  it("selects one bounded Base mainnet block", () => {
    expect(config.network).toMatchObject({ name: "base-mainnet", chainId: 8453 });
    expect(config.scan.fromBlock).toBe("41105890");
    expect(config.scan.toBlock).toBe("41105890");
    expect(config.scan.knownTransactions).toEqual([
      "0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a",
    ]);
  });

  it("limits detection to the two verified target event signatures", () => {
    expect(config.detectors.map(({ eventSignature }) => eventSignature)).toEqual([
      "Upgraded(address)",
      "PoolUpdated(address,address)",
    ]);
    expect(config.excludedIncidentClasses.map(({ id }) => id)).toEqual([
      "large_movement",
      "pause_unpause",
    ]);
  });

  it("contains one explicit example for every deterministic severity", () => {
    expect(config.severityPolicy.examples.map(({ severity }) => severity).sort()).toEqual([
      "high",
      "informational",
      "suspicious",
    ]);
    expect(config.severityPolicy.examples.filter(({ kind }) => kind === "verified-onchain")).toHaveLength(1);
    expect(config.severityPolicy.examples.filter(({ kind }) => kind === "counterfactual-policy")).toHaveLength(2);
  });
});
