import { describe, expect, it } from "vitest";

import type { Address } from "../src/chain/types.js";
import { targetConfigSchema } from "../src/config/schema.js";
import { getTargetProfile } from "../src/profiles/registry.js";
import { classifyUpgrade } from "../src/pipeline/severity.js";

const config = getTargetProfile("aave-v3-base-core");

describe("deterministic upgrade severity", () => {
  it.each(config.severityPolicy.examples)("classifies the $severity policy example", (example) => {
    const decision = classifyUpgrade(example.targetAddress as Address, config.severityPolicy);
    expect(decision.severity).toBe(example.severity);
    expect(decision.ruleId).toBe(example.ruleId);
  });

  it("classifies lowercase and checksum implementation addresses identically", () => {
    const checksum = config.severityPolicy.approvedTargetAddresses[0];
    const lowercase = checksum.toLowerCase() as Address;

    expect(classifyUpgrade(lowercase, config.severityPolicy)).toEqual(
      classifyUpgrade(checksum, config.severityPolicy),
    );
  });

  it("matches a checksum runtime implementation against a lowercase configured policy address", () => {
    const input = structuredClone(config);
    input.severityPolicy.approvedTargetAddresses[0] = input.severityPolicy.approvedTargetAddresses[0].toLowerCase() as Address;
    const lowercaseConfig = targetConfigSchema.parse(input);

    expect(classifyUpgrade(
      "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4",
      lowercaseConfig.severityPolicy,
    )).toMatchObject({ severity: "informational", ruleId: "target-is-approved" });
  });
});
