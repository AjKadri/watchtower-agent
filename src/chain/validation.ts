import { z } from "zod";

import { RpcReadError } from "./errors.js";
import type { ChainBlock, ChainLog, ChainLogBatch, ChainReceipt, ChainTransaction, MalformedChainLog } from "./types.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const nonnegativeBigInt = z.bigint().refine((value) => value >= 0n);
const nonnegativeInteger = z.number().int().nonnegative();

export const chainLogSchema = z.object({
  address,
  blockHash: hash,
  blockNumber: nonnegativeBigInt,
  data: hex,
  logIndex: nonnegativeInteger,
  topics: z.array(hash).min(1),
  transactionHash: hash,
  transactionIndex: nonnegativeInteger,
}).strict();

export const chainBlockSchema = z.object({
  hash,
  number: nonnegativeBigInt,
  timestamp: nonnegativeBigInt,
}).strict();

export const chainTransactionSchema = z.object({
  hash,
  from: address,
  to: address.nullable(),
}).strict();

export const chainReceiptSchema = z.object({
  transactionHash: hash,
  status: z.enum(["success", "reverted"]),
  logs: z.array(chainLogSchema),
}).strict();

const malformedChainLogSchema = z.object({
  code: z.literal("malformed-rpc-log"),
  message: z.string().min(1),
  blockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  transactionHash: hash.optional(),
  logIndex: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
}).strict();

function parseBoundary<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RpcReadError(operation, "malformed-response");
  return parsed.data;
}

function malformedLogFrom(value: unknown): MalformedChainLog {
  const failure: MalformedChainLog = {
    code: "malformed-rpc-log",
    message: "Base RPC returned one malformed log. Other valid logs from the response were preserved.",
  };
  if (!value || typeof value !== "object") return failure;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.blockNumber === "bigint" && candidate.blockNumber >= 0n) {
    failure.blockNumber = candidate.blockNumber.toString();
  }
  if (typeof candidate.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(candidate.transactionHash)) {
    failure.transactionHash = candidate.transactionHash as `0x${string}`;
  }
  if (typeof candidate.logIndex === "number" && Number.isSafeInteger(candidate.logIndex) && candidate.logIndex >= 0) {
    failure.logIndex = String(candidate.logIndex);
  }
  return failure;
}

export function validateChainLogBatch(value: unknown): ChainLogBatch {
  if (!value || typeof value !== "object") throw new RpcReadError("log request", "malformed-response");
  const batch = value as { logs?: unknown; malformed?: unknown };
  if (!Array.isArray(batch.logs) || !Array.isArray(batch.malformed)) {
    throw new RpcReadError("log request", "malformed-response");
  }
  const logs: ChainLog[] = [];
  const malformed: MalformedChainLog[] = [];
  for (const item of batch.logs) {
    const parsed = chainLogSchema.safeParse(item);
    if (parsed.success) logs.push(parsed.data as unknown as ChainLog);
    else malformed.push(malformedLogFrom(item));
  }
  for (const item of batch.malformed) {
    const parsed = malformedChainLogSchema.safeParse(item);
    malformed.push(parsed.success ? parsed.data as MalformedChainLog : malformedLogFrom(item));
  }
  return { logs, malformed };
}

export function validateChainBlock(value: unknown): ChainBlock {
  return parseBoundary(chainBlockSchema, value, "block request") as ChainBlock;
}

export function validateChainTransaction(value: unknown): ChainTransaction {
  return parseBoundary(chainTransactionSchema, value, "transaction request") as ChainTransaction;
}

export function validateChainReceipt(value: unknown): ChainReceipt {
  return parseBoundary(chainReceiptSchema, value, "receipt request") as unknown as ChainReceipt;
}
