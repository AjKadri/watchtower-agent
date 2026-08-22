import { describe, expect, it } from "vitest";

import type { Address } from "../src/chain/types.js";
import { targetConfigSchema } from "../src/config/schema.js";
import { classifyUpgrade } from "../src/pipeline/severity.js";
import { readJson } from "./helpers.js";

const config = targetConfigSchema.parse(readJson("../config/target.json", import.meta.url));

describe("deterministic upgrade severity", () => {
  it.each(config.severityPolicy.examples)("classifies the $severity policy example", (example) => {
    const decision = classifyUpgrade(example.targetAddress as Address, config.severityPolicy);
    expect(decision.severity).toBe(example.severity);
    expect(decision.ruleId).toBe(example.ruleId);
  });
});
