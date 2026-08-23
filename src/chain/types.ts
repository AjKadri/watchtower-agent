export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Hex = `0x${string}`;

export type ChainLog = {
  address: Address;
  blockHash: Hash;
  blockNumber: bigint;
  data: Hex;
  logIndex: number;
  topics: readonly [Hex, ...Hex[]];
  transactionHash: Hash;
  transactionIndex: number;
};

export type ChainBlock = {
  hash: Hash;
  number: bigint;
  timestamp: bigint;
};

export type ChainTransaction = {
  hash: Hash;
  from: Address;
  to: Address | null;
};

export type ChainReceipt = {
  transactionHash: Hash;
  status: "success" | "reverted";
  logs: ChainLog[];
};

export type LogFilter = {
  address: Address;
  topic0: Hex;
  fromBlock: bigint;
  toBlock: bigint;
};

export interface ChainReader {
  getChainId(): Promise<number>;
  getLatestBlockNumber(): Promise<bigint>;
  getLogs(filter: LogFilter): Promise<ChainLog[]>;
  getBlock(blockHash: Hash): Promise<ChainBlock>;
  getTransaction(transactionHash: Hash): Promise<ChainTransaction>;
  getTransactionReceipt(transactionHash: Hash): Promise<ChainReceipt>;
}
