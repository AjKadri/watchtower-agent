import { describe, expect, it } from "vitest";

import { classifyRpcError, RpcReadError } from "../src/chain/errors.js";
import { normalizeRpcLogs } from "../src/chain/viem-reader.js";

const validLog = {
  address: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
  blockHash: `0x${"a".repeat(64)}`,
  blockNumber: "0x27339e2",
  data: "0x",
  logIndex: "0x281",
  removed: false,
  topics: [
    "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
    "0x000000000000000000000000db578d67a83e94de73c9e0c14280f804f6c1c3e4",
  ],
  transactionHash: `0x${"b".repeat(64)}`,
  transactionIndex: "0x7a",
};

describe("viem reader normalization", () => {
  it("keeps valid logs when another response item is malformed", () => {
    const result = normalizeRpcLogs([
      validLog,
      { ...validLog, blockHash: null },
      { ...validLog, logIndex: `0x${"f".repeat(128)}` },
    ]);

    expect(result.logs).toHaveLength(1);
    expect(result.malformed).toHaveLength(2);
    expect(result.malformed[0]).toEqual(expect.objectContaining({
      code: "malformed-rpc-log",
      blockNumber: String(BigInt(validLog.blockNumber)),
      transactionHash: validLog.transactionHash,
      logIndex: String(Number(BigInt(validLog.logIndex))),
    }));
  });

  it("classifies safe RPC categories without exposing raw errors", () => {
    expect(classifyRpcError(Object.assign(new Error("getaddrinfo ENOTFOUND private.example"), { code: "ENOTFOUND" }))).toBe("dns");
    expect(classifyRpcError(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }))).toBe("timeout");
    expect(classifyRpcError(new DOMException("The operation was aborted.", "AbortError"))).toBe("timeout");
    expect(classifyRpcError({ status: 429, message: "provider detail" })).toBe("rate-limit");
    expect(classifyRpcError(new SyntaxError("Unexpected token in JSON"))).toBe("malformed-response");
    expect(new RpcReadError("log request", "dns").message).toBe("Base RPC log request failed.");
  });
});
