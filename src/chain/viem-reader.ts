import { createPublicClient, hexToBigInt, hexToNumber, http, toHex, type Address, type Hash, type Hex } from "viem";
import { base } from "viem/chains";

import { RpcReadError, wrapRpcError } from "./errors.js";
import type { ChainBlock, ChainLog, ChainLogBatch, ChainReader, ChainReceipt, ChainTransaction, LogFilter, MalformedChainLog } from "./types.js";
import { validateChainBlock, validateChainReceipt, validateChainTransaction } from "./validation.js";

type RpcLog = {
  address: Address;
  blockHash: Hash | null;
  blockNumber: Hex | null;
  data: Hex;
  logIndex: Hex | null;
  removed: boolean;
  topics: Hex[];
  transactionHash: Hash | null;
  transactionIndex: Hex | null;
};

function required<T>(value: T | null, field: string): T {
  if (value === null) {
    throw new Error(`Base RPC returned a log without ${field}.`);
  }
  return value;
}

function normalizeLog(log: RpcLog): ChainLog {
  if (typeof log.removed !== "boolean") throw new Error("invalid removed flag");
  if (typeof log.address !== "string" || !/^0x[0-9a-f]{40}$/i.test(log.address)) throw new Error("invalid log address");
  if (typeof log.blockHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(log.blockHash)) throw new Error("invalid block hash");
  if (typeof log.blockNumber !== "string" || !/^0x[0-9a-f]+$/i.test(log.blockNumber)) throw new Error("invalid block number");
  if (typeof log.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)) throw new Error("invalid log data");
  if (typeof log.logIndex !== "string" || !/^0x[0-9a-f]+$/i.test(log.logIndex)) throw new Error("invalid log index");
  if (!Array.isArray(log.topics) || log.topics.length === 0 || log.topics.some((topic) => !/^0x[0-9a-f]{64}$/i.test(topic))) {
    throw new Error("invalid log topics");
  }
  if (typeof log.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash)) throw new Error("invalid transaction hash");
  if (typeof log.transactionIndex !== "string" || !/^0x[0-9a-f]+$/i.test(log.transactionIndex)) throw new Error("invalid transaction index");

  const topics = log.topics as [Hex, ...Hex[]];

  return {
    address: log.address,
    blockHash: log.blockHash,
    blockNumber: hexToBigInt(log.blockNumber),
    data: log.data,
    logIndex: hexToNumber(log.logIndex),
    topics,
    transactionHash: log.transactionHash,
    transactionIndex: hexToNumber(log.transactionIndex),
  };
}

function safeMalformedLog(log: Partial<RpcLog>): MalformedChainLog {
  const malformed: MalformedChainLog = {
    code: "malformed-rpc-log",
    message: "Base RPC returned one malformed log. Other valid logs from the response were preserved.",
  };
  try {
    if (typeof log.blockNumber === "string" && /^0x[0-9a-f]+$/i.test(log.blockNumber)) {
      malformed.blockNumber = hexToBigInt(log.blockNumber).toString();
    }
  } catch {}
  if (typeof log.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(log.transactionHash)) {
    malformed.transactionHash = log.transactionHash as Hash;
  }
  try {
    if (typeof log.logIndex === "string" && /^0x[0-9a-f]+$/i.test(log.logIndex)) {
      malformed.logIndex = String(hexToNumber(log.logIndex));
    }
  } catch {}
  return malformed;
}

export function normalizeRpcLogs(value: unknown): ChainLogBatch {
  if (!Array.isArray(value)) {
    throw new RpcReadError("log request", "malformed-response");
  }

  const logs: ChainLog[] = [];
  const malformed: MalformedChainLog[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      malformed.push(safeMalformedLog({}));
      continue;
    }
    const log = item as RpcLog;
    if (log.removed === true) continue;
    try {
      logs.push(normalizeLog(log));
    } catch {
      malformed.push(safeMalformedLog(log));
    }
  }
  return { logs, malformed };
}

export function createViemChainReader(rpcUrl: string): ChainReader {
  const createClient = (signal?: AbortSignal) => createPublicClient({
    chain: base,
    transport: http(rpcUrl, {
      retryCount: 2,
      retryDelay: 250,
      timeout: 10_000,
      ...(signal && { fetchOptions: { signal } }),
    }),
  });

  return {
    async getChainId(signal) {
      try {
        return await createClient(signal).getChainId();
      } catch (error) {
        throw wrapRpcError("chain-ID request", error);
      }
    },

    async getLatestBlockNumber(signal) {
      try {
        return await createClient(signal).getBlockNumber();
      } catch (error) {
        throw wrapRpcError("latest-block request", error);
      }
    },

    async getLogs(filter: LogFilter, signal) {
      try {
        const logs = await createClient(signal).request({
          method: "eth_getLogs",
          params: [{
            address: filter.address,
            topics: [filter.topic0],
            fromBlock: toHex(filter.fromBlock),
            toBlock: toHex(filter.toBlock),
          }],
        }, { signal });
        return normalizeRpcLogs(logs);
      } catch (error) {
        throw wrapRpcError("log request", error);
      }
    },

    async getBlock(blockHash, signal) {
      try {
        const block = await createClient(signal).getBlock({ blockHash });
        return validateChainBlock({
          hash: block.hash,
          number: block.number,
          timestamp: block.timestamp,
        });
      } catch (error) {
        throw wrapRpcError("block request", error);
      }
    },

    async getTransaction(transactionHash, signal) {
      try {
        const transaction = await createClient(signal).getTransaction({ hash: transactionHash });
        return validateChainTransaction({
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
        });
      } catch (error) {
        throw wrapRpcError("transaction request", error);
      }
    },

    async getTransactionReceipt(transactionHash, signal) {
      try {
        const receipt = await createClient(signal).getTransactionReceipt({ hash: transactionHash });
        const logs = receipt.logs
          .filter(({ removed }) => !removed)
          .map((log) => ({
              address: log.address,
              blockHash: log.blockHash,
              blockNumber: log.blockNumber,
              data: log.data,
              logIndex: log.logIndex,
              topics: log.topics,
              transactionHash: log.transactionHash,
              transactionIndex: log.transactionIndex,
            }));
        return validateChainReceipt({
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          logs,
        });
      } catch (error) {
        throw wrapRpcError("receipt request", error);
      }
    },

    async getStorageAt(address, slot, blockNumber, signal) {
      try {
        const value = await createClient(signal).getStorageAt({ address, slot, blockNumber });
        if (value === undefined || !/^0x[0-9a-f]{64}$/i.test(value)) {
          throw new RpcReadError("historical storage request", "malformed-response");
        }
        return value;
      } catch (error) {
        throw wrapRpcError("historical storage request", error);
      }
    },

    async getCode(address, blockNumber, signal) {
      try {
        const value = await createClient(signal).getCode({ address, blockNumber });
        if (value === undefined || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) {
          throw new RpcReadError("historical code request", "malformed-response");
        }
        return value;
      } catch (error) {
        throw wrapRpcError("historical code request", error);
      }
    },

    async call(address, data, blockNumber, signal) {
      try {
        const result = await createClient(signal).call({ to: address, data, blockNumber });
        if (result.data === undefined || !/^0x(?:[0-9a-f]{2})*$/i.test(result.data)) {
          throw new RpcReadError("historical contract call", "malformed-response");
        }
        return result.data;
      } catch (error) {
        throw wrapRpcError("historical contract call", error);
      }
    },
  };
}
