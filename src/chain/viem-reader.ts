import { createPublicClient, hexToBigInt, hexToNumber, http, toHex, type Address, type Hash, type Hex } from "viem";
import { base } from "viem/chains";

import type { ChainBlock, ChainLog, ChainReader, ChainReceipt, ChainTransaction, LogFilter } from "./types.js";

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
  const topics = log.topics as [Hex, ...Hex[]];
  if (topics.length === 0) {
    throw new Error("Base RPC returned a log without topics.");
  }

  return {
    address: log.address,
    blockHash: required(log.blockHash, "blockHash"),
    blockNumber: hexToBigInt(required(log.blockNumber, "blockNumber")),
    data: log.data,
    logIndex: hexToNumber(required(log.logIndex, "logIndex")),
    topics,
    transactionHash: required(log.transactionHash, "transactionHash"),
    transactionIndex: hexToNumber(required(log.transactionIndex, "transactionIndex")),
  };
}

function rpcError(operation: string): Error {
  return new Error(`Base RPC ${operation} failed.`);
}

export function createViemChainReader(rpcUrl: string): ChainReader {
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl, { retryCount: 2, retryDelay: 250, timeout: 10_000 }),
  });

  return {
    async getChainId() {
      try {
        return await client.getChainId();
      } catch {
        throw rpcError("chain-ID request");
      }
    },

    async getLatestBlockNumber() {
      try {
        return await client.getBlockNumber();
      } catch {
        throw rpcError("latest-block request");
      }
    },

    async getLogs(filter: LogFilter) {
      try {
        const logs = await client.request({
          method: "eth_getLogs",
          params: [{
            address: filter.address,
            topics: [filter.topic0],
            fromBlock: toHex(filter.fromBlock),
            toBlock: toHex(filter.toBlock),
          }],
        }) as RpcLog[];
        return logs.filter(({ removed }) => !removed).map(normalizeLog);
      } catch {
        throw rpcError("log request");
      }
    },

    async getBlock(blockHash) {
      try {
        const block = await client.getBlock({ blockHash });
        return {
          hash: required(block.hash, "block hash"),
          number: required(block.number, "block number"),
          timestamp: block.timestamp,
        } satisfies ChainBlock;
      } catch {
        throw rpcError("block request");
      }
    },

    async getTransaction(transactionHash) {
      try {
        const transaction = await client.getTransaction({ hash: transactionHash });
        return {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
        } satisfies ChainTransaction;
      } catch {
        throw rpcError("transaction request");
      }
    },

    async getTransactionReceipt(transactionHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: transactionHash });
        return {
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          logs: receipt.logs.filter(({ removed }) => !removed).map((log) => {
            const topics = log.topics as [Hex, ...Hex[]];
            if (topics.length === 0) throw new Error("Base RPC returned a receipt log without topics.");
            return {
              address: log.address,
              blockHash: required(log.blockHash, "blockHash"),
              blockNumber: required(log.blockNumber, "blockNumber"),
              data: log.data,
              logIndex: required(log.logIndex, "logIndex"),
              topics,
              transactionHash: required(log.transactionHash, "transactionHash"),
              transactionIndex: required(log.transactionIndex, "transactionIndex"),
            } satisfies ChainLog;
          }),
        } satisfies ChainReceipt;
      } catch {
        throw rpcError("receipt request");
      }
    },
  };
}
