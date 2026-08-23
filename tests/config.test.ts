import { describe, expect, it } from "vitest";

import { loadTargetConfig } from "../src/config/load.js";
import { targetConfigSchema } from "../src/config/schema.js";
import { validateUpgradeEventAbi } from "../src/events/upgrade.js";
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

  it("limits detection to the verified Pool upgrade signature", () => {
    expect(config.detectors.map(({ eventSignature }) => eventSignature)).toEqual([
      "Upgraded(address)",
    ]);
    expect(config.detectors[0].classificationLabel).toBe("Contract upgrade");
    expect(config.excludedIncidentClasses.map(({ id }) => id)).toEqual([
      "ownership_admin",
      "large_movement",
      "pause_unpause",
    ]);
  });

  it("loads the committed ABI and validates it against the decoder and topic", async () => {
    const loaded = await loadTargetConfig();
    const abi = readJson("../config/abis/aave-base-upgrade-events.json", import.meta.url);

    expect(loaded.detectors[0].topic0).toBe(config.detectors[0].topic0);
    expect(validateUpgradeEventAbi(abi, config.detectors[0].topic0)).toHaveLength(1);
    expect(() => validateUpgradeEventAbi(abi, `0x${"0".repeat(64)}`)).toThrow(/do not match/);
    expect(() => validateUpgradeEventAbi([{ ...(abi as Array<Record<string, unknown>>)[0], anonymous: true }], config.detectors[0].topic0)).toThrow();
  });

  it("rejects additional detectors and related contracts", () => {
    const expanded = structuredClone(config) as unknown as {
      detectors: unknown[];
      target: { relatedContracts: unknown[] };
    };
    expanded.detectors.push({ id: "unsupported" });
    expanded.target.relatedContracts.push({
      address: "0x1111111111111111111111111111111111111111",
      role: "unsupported",
    });

    expect(targetConfigSchema.safeParse(expanded).success).toBe(false);
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
