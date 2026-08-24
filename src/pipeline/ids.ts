import { createHash } from "node:crypto";

function deterministicId(namespace: string, parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex");
  return `${namespace}_${digest}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

export function createScanId(chainId: number, targetId: string, fromBlock: bigint, toBlock: bigint): string {
  return deterministicId("scan", [String(chainId), targetId, fromBlock.toString(), toBlock.toString()]);
}

export function createAlertId(chainId: number, transactionHash: string, logIndex: number, detectorId: string): string {
  return deterministicId("alert", [String(chainId), transactionHash.toLowerCase(), String(logIndex), detectorId]);
}

export function createReceiptId(payload: unknown): string {
  return deterministicId("receipt", [canonicalJson(payload)]);
}
