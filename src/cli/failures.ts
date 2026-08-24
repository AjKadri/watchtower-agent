import { ZodError } from "zod";

import { RpcReadError } from "../chain/errors.js";

export type CliFailurePhase = "configuration" | "runtime";

export type CliFailure = {
  code:
    | "configuration-validation-failed"
    | "configuration-json-invalid"
    | "configuration-unavailable"
    | "configuration-load-failed"
    | "runtime-validation-failed"
    | "evidence-consistency-failed"
    | "rpc-failed"
    | "runtime-scan-failed";
  message: string;
  category?: RpcReadError["category"];
};

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isEvidenceConsistencyError(error: ZodError): boolean {
  return error.issues.some((issue) => {
    const path = issue.path.map(String);
    return path.some((segment) => [
      "evidence",
      "investigationReceipt",
      "receiptId",
      "trigger",
      "checks",
      "finalDisposition",
      "explorerLinks",
    ].includes(segment)) || /receipt|evidence|containing investigation|assertion/.test(issue.message.toLowerCase());
  });
}

export function classifyCliFailure(error: unknown, phase: CliFailurePhase): CliFailure {
  if (phase === "configuration") {
    if (error instanceof ZodError) {
      return { code: "configuration-validation-failed", message: "Watchtower configuration validation failed." };
    }
    if (error instanceof SyntaxError) {
      return { code: "configuration-json-invalid", message: "Watchtower target configuration is not valid JSON." };
    }
    if (isMissingFileError(error)) {
      return { code: "configuration-unavailable", message: "Watchtower target configuration could not be read." };
    }
    return { code: "configuration-load-failed", message: "Watchtower configuration could not be loaded." };
  }

  if (error instanceof ZodError) {
    return isEvidenceConsistencyError(error)
      ? { code: "evidence-consistency-failed", message: "Watchtower rejected inconsistent runtime evidence or receipt data." }
      : { code: "runtime-validation-failed", message: "Watchtower runtime scan-result validation failed." };
  }
  if (error instanceof RpcReadError) {
    return { code: "rpc-failed", category: error.category, message: "A Base RPC operation failed during the bounded scan." };
  }
  return { code: "runtime-scan-failed", message: "Watchtower could not complete the bounded scan." };
}
