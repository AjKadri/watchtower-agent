import { describe, expect, it } from "vitest";

import { loadTargetConfig } from "../src/config/load.js";
import { targetConfigSchema, targetProfileSelectionSchema } from "../src/config/schema.js";
import { validateUpgradeEventAbi } from "../src/events/upgrade.js";
import {
  getTargetProfile,
  listTargetProfiles,
  resolveTargetProfile,
} from "../src/profiles/registry.js";
import { readJson } from "./helpers.js";

const config = getTargetProfile("aave-v3-base-core");

describe("closed target profile registry", () => {
  it("keeps the fixture-backed Aave profile unchanged", async () => {
    const loaded = await loadTargetConfig();

    expect(loaded).toEqual(config);
    expect(loaded.network).toMatchObject({ name: "base-mainnet", chainId: 8453 });
    expect(loaded.scan).toMatchObject({
      fromBlock: "41105890",
      toBlock: "41105890",
      knownTransactions: ["0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a"],
    });
    expect(loaded.expectedFixture).toMatchObject({ status: "committed", logIndex: "641" });
  });

  it("registers exactly the three approved Base profiles", () => {
    const profiles = listTargetProfiles();

    expect(profiles.map(({ profileId }) => profileId)).toEqual([
      "aave-v3-base-core",
      "compound-iii-base-usdc-comet",
      "etherfi-base-weeth-oft",
    ]);
    for (const profile of profiles) {
      expect(targetConfigSchema.safeParse(profile).success).toBe(true);
      expect(profile.network.chainId).toBe(8453);
      expect(profile.scan.fromBlock).toBe(profile.scan.toBlock);
      expect(profile.detectors).toHaveLength(1);
      expect(profile.investigation.checks).toHaveLength(6);
      expect(profile.plans.approved.capabilityBudget.maximumReads).toBe(6);
    }
    expect(profiles.slice(1).every(({ expectedFixture }) => expectedFixture.status === "pending" && expectedFixture.path === null)).toBe(true);
  });

  it("rejects unknown profile IDs and selection overrides", () => {
    expect(() => getTargetProfile("unknown-profile")).toThrow();
    expect(() => resolveTargetProfile({ profileId: "unknown-profile" })).toThrow();
    expect(targetProfileSelectionSchema.safeParse({
      profileId: "aave-v3-base-core",
      primaryContract: "0x1111111111111111111111111111111111111111",
    }).success).toBe(false);
  });

  it("rejects mutations to registered addresses, calls, and profile check IDs", () => {
    const mutated = structuredClone(getTargetProfile("compound-iii-base-usdc-comet"));
    mutated.target.primaryContract.address = "0x1111111111111111111111111111111111111111";
    mutated.investigation.checks[3].id = "configured-pool";
    if (mutated.investigation.checks[3].kind === "call-address") {
      mutated.investigation.checks[3].data = "0x1234";
    }

    expect(targetConfigSchema.safeParse(mutated).success).toBe(false);
  });

  it("loads the committed static ABI and validates it against every registered topic", () => {
    const abi = readJson("../config/abis/aave-base-upgrade-events.json", import.meta.url);

    for (const profile of listTargetProfiles()) {
      expect(validateUpgradeEventAbi(abi, profile.detectors[0].topic0)).toHaveLength(1);
    }
    expect(() => validateUpgradeEventAbi(abi, `0x${"0".repeat(64)}`)).toThrow(/do not match/);
    expect(() => validateUpgradeEventAbi([{ ...(abi as Array<Record<string, unknown>>)[0], anonymous: true }], config.detectors[0].topic0)).toThrow();
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

  it("normalizes equivalent address casing without changing a registered profile", () => {
    const input = structuredClone(config);
    input.target.primaryContract.address = input.target.primaryContract.address.toLowerCase() as `0x${string}`;
    input.detectors[0].contractAddresses[0] = input.detectors[0].contractAddresses[0].toLowerCase() as `0x${string}`;
    input.severityPolicy.approvedTargetAddresses[0] = input.severityPolicy.approvedTargetAddresses[0].toLowerCase() as `0x${string}`;

    const parsed = targetConfigSchema.parse(input);

    expect(parsed.target.primaryContract.address).toBe(config.target.primaryContract.address);
    expect(parsed.severityPolicy.approvedTargetAddresses[0]).toBe(config.severityPolicy.approvedTargetAddresses[0]);
  });
});
