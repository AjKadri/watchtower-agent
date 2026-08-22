import { describe, expect, it } from "vitest";

import { alertSchema, evidenceSchema } from "../src/domain/schemas.js";

// Schema-only values stay synthetic so this test cannot be mistaken for evidence.
const transactionHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const pool = `0x${"c".repeat(40)}`;
const implementation = `0x${"d".repeat(40)}`;
const sources = {
  transaction: `https://basescan.org/tx/${transactionHash}`,
  block: "https://basescan.org/block/41105890",
  addresses: { emitter: `https://basescan.org/address/${pool}` },
};

describe("normalized records", () => {
  it("accepts a complete evidence record with decimal onchain quantities", () => {
    const result = evidenceSchema.safeParse({
      id: "8453:748f:641:aave-pool-upgraded",
      status: "complete",
      network: { name: "base-mainnet", chainId: 8453 },
      block: { number: "41105890", hash: blockHash, timestamp: "2026-01-21T13:12:07.000Z" },
      transaction: { hash: transactionHash, sender: pool, recipient: pool, receiptStatus: "success" },
      log: {
        index: "641",
        emitter: pool,
        topic0: "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
        rawTopics: [
          "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
          "0x000000000000000000000000db578d67a83e94de73c9e0c14280f804f6c1c3e4",
        ],
      },
      event: { signature: "Upgraded(address)", decodedArguments: { implementation } },
      relevantAddresses: [{ address: pool, role: "pool-proxy" }, { address: implementation, role: "new-implementation" }],
      detector: { id: "aave-pool-upgraded", inputs: { emitter: pool } },
      severity: { ruleId: "target-is-approved", inputs: { targetAddress: implementation }, result: "informational" },
      observedFacts: ["The configured pool proxy emitted Upgraded(address)."],
      sources,
      errors: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a normalized alert linked to its evidence", () => {
    expect(
      alertSchema.safeParse({
        id: "8453:748f:641:aave-pool-upgraded",
        scanId: "demo-41105890",
        targetId: "aave-v3-base-core",
        incidentClass: "upgrade_pause",
        eventType: "proxy_upgraded",
        severity: "informational",
        severityRuleId: "target-is-approved",
        title: "Configured Aave pool proxy implementation updated",
        summary: "The configured pool proxy emitted Upgraded(address) with an approved implementation target.",
        observedAt: "2026-01-21T13:12:07.000Z",
        evidenceStatus: "complete",
        evidenceId: "evidence:8453:748f:641",
        sources,
      }).success,
    ).toBe(true);
  });

  it("rejects non-decimal block values", () => {
    const invalid = {
      id: "bad",
      status: "incomplete",
      network: { name: "base-mainnet", chainId: 8453 },
      block: { number: "0x27339e2", hash: blockHash, timestamp: "2026-01-21T13:12:07.000Z" },
    };

    expect(evidenceSchema.safeParse(invalid).success).toBe(false);
  });
});
