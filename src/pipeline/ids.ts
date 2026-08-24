import { createHash } from "node:crypto";

import { normalizeEvmAddresses } from "../evm/address.js";

function deterministicId(namespace: string, parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex");
  return `${namespace}_${digest}`;
}

export type CanonicalReceiptPayload = {
  schemaVersion: unknown;
  trigger: unknown;
  plan: unknown;
  checks: unknown;
  errors: unknown;
  limitations: unknown;
  finalDisposition: unknown;
  explorerLinks: unknown;
};

export function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new TypeError("Canonical serialization accepts JSON values only.");
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalReceiptPayload(receipt: CanonicalReceiptPayload): CanonicalReceiptPayload {
  return normalizeEvmAddresses({
    schemaVersion: receipt.schemaVersion,
    trigger: receipt.trigger,
    plan: receipt.plan,
    checks: receipt.checks,
    errors: receipt.errors,
    limitations: receipt.limitations,
    finalDisposition: receipt.finalDisposition,
    explorerLinks: receipt.explorerLinks,
  });
}

export function createScanId(chainId: number, targetId: string, fromBlock: bigint, toBlock: bigint): string {
  return deterministicId("scan", [String(chainId), targetId, fromBlock.toString(), toBlock.toString()]);
}

export function createAlertId(chainId: number, transactionHash: string, logIndex: number, detectorId: string): string {
  return deterministicId("alert", [String(chainId), transactionHash.toLowerCase(), String(logIndex), detectorId]);
}

export function createReceiptId(receipt: CanonicalReceiptPayload): string {
  return deterministicId("receipt", [stableSerialize(canonicalReceiptPayload(receipt))]);
}
