import { z } from "zod";
import { describe, expect, it } from "vitest";

import { RpcReadError } from "../src/chain/errors.js";
import { classifyCliFailure } from "../src/cli/failures.js";

function captureZodError(schema: z.ZodType, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("test input unexpectedly passed schema validation");
  return result.error;
}

describe("CLI failure classification", () => {
  it("does not report a runtime scan-result validation defect as invalid configuration", () => {
    const error = captureZodError(z.object({ status: z.literal("complete") }), { status: "failed" });

    expect(classifyCliFailure(error, "runtime")).toEqual({
      code: "runtime-validation-failed",
      message: "Watchtower runtime scan-result validation failed.",
    });
    expect(classifyCliFailure(error, "configuration").code).toBe("configuration-validation-failed");
  });

  it("separates evidence consistency and RPC failures without exposing raw errors", () => {
    const consistencyError = captureZodError(
      z.object({ investigationReceipt: z.object({ receiptId: z.literal("valid") }) }),
      { investigationReceipt: { receiptId: "forged" } },
    );
    const rpcError = new RpcReadError("secret provider operation", "timeout");

    expect(classifyCliFailure(consistencyError, "runtime")).toEqual({
      code: "evidence-consistency-failed",
      message: "Watchtower rejected inconsistent runtime evidence or receipt data.",
    });
    expect(classifyCliFailure(rpcError, "runtime")).toEqual({
      code: "rpc-failed",
      category: "timeout",
      message: "A Base RPC operation failed during the bounded scan.",
    });
    expect(JSON.stringify(classifyCliFailure(rpcError, "runtime"))).not.toContain("secret provider operation");
  });
});
