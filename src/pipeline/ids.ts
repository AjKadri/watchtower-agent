import { createHash } from "node:crypto";

function deterministicId(namespace: string, parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex");
  return `${namespace}_${digest}`;
}

export function createScanId(chainId: number, targetId: string, fromBlock: bigint, toBlock: bigint): string {
  return deterministicId("scan", [String(chainId), targetId, fromBlock.toString(), toBlock.toString()]);
}

export function createAlertId(chainId: number, transactionHash: string, logIndex: number, detectorId: string): string {
  return deterministicId("alert", [String(chainId), transactionHash.toLowerCase(), String(logIndex), detectorId]);
}
