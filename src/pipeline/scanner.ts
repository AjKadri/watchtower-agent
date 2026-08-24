import type { Address, ChainBlock, ChainLog, ChainReader, ChainReceipt, ChainTransaction, Hash } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import type { Alert, Evidence, ScanFailure, ScanResult } from "../domain/schemas.js";
import { scanResultSchema } from "../domain/schemas.js";
import { RpcReadError, type RpcFailureCategory } from "../chain/errors.js";
import { decodeUpgradeLog, upgradedEventType } from "../events/upgrade.js";
import { explainEvidence } from "../investigation/explain.js";
import { selectInvestigationPlan } from "../investigation/plans.js";
import { createInvestigationReceipt } from "../investigation/receipt.js";
import { investigateApprovedUpgrade } from "../investigation/upgrade.js";
import { createAlertId, createScanId } from "./ids.js";
import { classifyUpgrade } from "./severity.js";

export type ScanBounds = { fromBlock?: bigint; toBlock?: bigint };

const BASE_MAINNET_CHAIN_ID = 8453;

type EvidenceCaches = {
  blocks: Map<Hash, Promise<ChainBlock>>;
  transactions: Map<Hash, Promise<ChainTransaction>>;
  receipts: Map<Hash, Promise<ChainReceipt>>;
};

function cached<K, V>(cache: Map<K, Promise<V>>, key: K, loader: () => Promise<V>): Promise<V> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = loader();
  cache.set(key, pending);
  return pending;
}

function failure(
  code: string,
  stage: ScanFailure["stage"],
  message: string,
  log?: ChainLog,
): ScanFailure {
  return {
    code,
    stage,
    message,
    ...(log && {
      blockNumber: log.blockNumber.toString(),
      transactionHash: log.transactionHash,
      logIndex: String(log.logIndex),
    }),
  };
}

function rpcCategory(error: unknown): RpcFailureCategory {
  return error instanceof RpcReadError ? error.category : "unavailable";
}

function rpcFailure(code: string, message: string, error: unknown, context: Partial<ScanFailure> = {}): ScanFailure {
  const category = rpcCategory(error);
  return {
    code: category === "unavailable" ? `${code}-failed` : `${code}-${category}`,
    stage: "rpc",
    category,
    message,
    ...context,
  };
}

function failedResult(config: TargetConfig, fromBlock: bigint, toBlock: bigint, item: ScanFailure): ScanResult {
  return scanResultSchema.parse({
    scanId: createScanId(config.network.chainId, config.target.id, fromBlock, toBlock),
    targetId: config.target.id,
    range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
    status: "failed",
    alerts: [],
    evidence: [],
    failures: [item],
  });
}

function validateBounds(config: TargetConfig, fromBlock: bigint, toBlock: bigint): ScanFailure | undefined {
  const approvedFrom = BigInt(config.scan.fromBlock);
  const approvedTo = BigInt(config.scan.toBlock);
  const maxBlockSpan = BigInt(config.scan.maxBlockSpan);

  if (fromBlock > toBlock) {
    return failure("invalid-range", "validation", "The scan start block exceeds the end block.");
  }
  if (fromBlock < approvedFrom || toBlock > approvedTo) {
    return failure("range-outside-approved-bounds", "validation", "The requested range is outside the approved demo range.");
  }
  if (toBlock - fromBlock + 1n > maxBlockSpan) {
    return failure("range-too-large", "validation", "The requested range exceeds the configured maximum span.");
  }
  return undefined;
}

function exactScope(log: ChainLog, address: string, topic0: string, fromBlock: bigint, toBlock: bigint): boolean {
  return log.address.toLowerCase() === address.toLowerCase()
    && log.topics[0]?.toLowerCase() === topic0.toLowerCase()
    && log.blockNumber >= fromBlock
    && log.blockNumber <= toBlock;
}

async function buildEvidence(
  reader: ChainReader,
  config: TargetConfig,
  log: ChainLog,
  implementation: Address,
  caches: EvidenceCaches,
): Promise<{ alert: Alert; evidence: Evidence; failures: ScanFailure[] }> {
  const detector = config.detectors[0];
  const alertId = createAlertId(config.network.chainId, log.transactionHash, log.logIndex, detector.id);
  const evidenceId = `evidence_${alertId.slice("alert_".length)}`;
  const severity = classifyUpgrade(implementation, config.severityPolicy);
  const errors: Evidence["errors"] = [];
  const scanFailures: ScanFailure[] = [];

  const [blockResult, transactionResult, receiptResult] = await Promise.allSettled([
    cached(caches.blocks, log.blockHash, () => reader.getBlock(log.blockHash)),
    cached(caches.transactions, log.transactionHash, () => reader.getTransaction(log.transactionHash)),
    cached(caches.receipts, log.transactionHash, () => reader.getTransactionReceipt(log.transactionHash)),
  ]);

  const addEvidenceError = (code: string, message: string, category: ScanFailure["category"] = "incomplete-evidence") => {
    errors.push({ code, message });
    scanFailures.push({ ...failure(code, "evidence", message, log), category });
  };

  const addUnavailableEvidenceError = (prefix: string, message: string, reason: unknown) => {
    const category = rpcCategory(reason);
    const code = `${prefix}-${category}`;
    addEvidenceError(code, message, category);
  };

  const block = blockResult.status === "fulfilled" ? blockResult.value : null;
  let blockVerified = false;
  if (!block) addUnavailableEvidenceError("block-evidence", "The block timestamp could not be retrieved from Base RPC.", blockResult.status === "rejected" ? blockResult.reason : undefined);
  else if (block.hash.toLowerCase() !== log.blockHash.toLowerCase() || block.number !== log.blockNumber) {
    addEvidenceError("block-evidence-mismatch", "The retrieved block identity does not match the candidate log.");
  } else blockVerified = true;

  const transaction = transactionResult.status === "fulfilled" ? transactionResult.value : null;
  let transactionVerified = false;
  if (!transaction) addUnavailableEvidenceError("transaction-evidence", "The transaction sender and recipient could not be retrieved from Base RPC.", transactionResult.status === "rejected" ? transactionResult.reason : undefined);
  else if (transaction.hash.toLowerCase() !== log.transactionHash.toLowerCase()) {
    addEvidenceError("transaction-evidence-mismatch", "The retrieved transaction hash does not match the candidate log.");
  } else transactionVerified = true;

  const receipt = receiptResult.status === "fulfilled" ? receiptResult.value : null;
  let receiptVerified = false;
  if (!receipt) addUnavailableEvidenceError("receipt-evidence", "The transaction receipt could not be retrieved from Base RPC.", receiptResult.status === "rejected" ? receiptResult.reason : undefined);
  else {
    const receiptHashMatches = receipt.transactionHash.toLowerCase() === log.transactionHash.toLowerCase();
    if (!receiptHashMatches) {
      addEvidenceError("receipt-evidence-mismatch", "The retrieved receipt hash does not match the candidate log.");
    }
    const receiptContainsLog = receipt.logs.some((receiptLog) =>
      receiptLog.logIndex === log.logIndex
      && receiptLog.transactionHash.toLowerCase() === log.transactionHash.toLowerCase()
      && receiptLog.address.toLowerCase() === log.address.toLowerCase()
      && receiptLog.blockHash.toLowerCase() === log.blockHash.toLowerCase()
      && receiptLog.blockNumber === log.blockNumber
      && receiptLog.data.toLowerCase() === log.data.toLowerCase()
      && receiptLog.topics.length === log.topics.length
      && receiptLog.topics.every((topic, index) => topic.toLowerCase() === log.topics[index]?.toLowerCase()));
    if (!receiptContainsLog) {
      addEvidenceError("receipt-log-missing", "The retrieved receipt does not contain the candidate log.");
    }
    receiptVerified = receiptHashMatches && receiptContainsLog;
  }

  const triggerEvidenceComplete = blockVerified && transactionVerified && receiptVerified;
  const plan = selectInvestigationPlan({
    targetId: config.target.id,
    eventSignature: detector.eventSignature,
    triggerEvidenceStatus: triggerEvidenceComplete ? "complete" : "incomplete",
    severityRuleId: severity.ruleId,
  });
  const upgradeInvestigation = await investigateApprovedUpgrade(reader, config, implementation, plan);
  for (const check of upgradeInvestigation.checks) {
    if (check.failure) {
      addEvidenceError(check.failure.code, check.failure.message, check.failure.category);
    }
  }

  const explorer = config.network.explorerBaseUrl;
  const evidenceStatus = errors.length === 0 ? "complete" : "incomplete";
  const sources = {
    transaction: `${explorer}/tx/${log.transactionHash}`,
    block: `${explorer}/block/${log.blockNumber}`,
    addresses: {
      emitter: `${explorer}/address/${log.address}`,
        implementation: `${explorer}/address/${implementation}`,
        provider: `${explorer}/address/${config.investigation.poolAddressesProvider}`,
      ...(transactionVerified && transaction?.from && { sender: `${explorer}/address/${transaction.from}` }),
      ...(transactionVerified && transaction?.to && { recipient: `${explorer}/address/${transaction.to}` }),
    },
  };

  const observedFacts = [
    `The configured Aave V3 Base Pool proxy emitted ${detector.eventSignature} at log index ${log.logIndex}.`,
    `The decoded implementation address is ${implementation}.`,
  ];
  if (receiptVerified) observedFacts.push(`The transaction receipt status is ${receipt?.status}.`);

  const investigationReceipt = triggerEvidenceComplete && block && transaction && receipt
    ? createInvestigationReceipt({
      network: { name: config.network.name, chainId: config.network.chainId },
      targetId: config.target.id,
      incidentClass: detector.incidentClass,
      eventType: upgradedEventType,
      eventSignature: detector.eventSignature,
      decodedArguments: { implementation },
      block: {
        number: config.scan.toBlock,
        hash: block.hash,
        timestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
      },
      transaction: {
        hash: transaction.hash,
        sender: transaction.from,
        recipient: transaction.to,
        receiptStatus: receipt.status,
      },
      log: {
        index: String(log.logIndex),
        emitter: config.target.primaryContract.address,
        topic0: detector.topic0,
        rawTopics: [...log.topics],
      },
      detector: { id: detector.id, severityRuleId: severity.ruleId, severity: severity.severity },
    }, upgradeInvestigation, sources)
    : null;

  const evidence: Evidence = {
    id: evidenceId,
    status: evidenceStatus,
    network: config.network,
    block: {
      number: log.blockNumber.toString(),
      hash: log.blockHash,
      timestamp: blockVerified ? new Date(Number(block?.timestamp) * 1_000).toISOString() : null,
    },
    transaction: {
      hash: log.transactionHash,
      sender: transactionVerified ? transaction?.from ?? null : null,
      recipient: transactionVerified ? transaction?.to ?? null : null,
      receiptStatus: receiptVerified ? receipt?.status ?? null : null,
    },
    log: {
      index: String(log.logIndex),
      emitter: log.address,
      topic0: log.topics[0],
      rawTopics: [...log.topics],
    },
    event: { signature: detector.eventSignature, decodedArguments: { implementation } },
    relevantAddresses: [
      { address: log.address, role: config.target.primaryContract.role },
      { address: implementation, role: "decoded-implementation" },
      { address: config.investigation.poolAddressesProvider, role: "pool-addresses-provider" },
    ],
    detector: {
      id: detector.id,
      inputs: { configuredEmitter: detector.contractAddresses[0], configuredTopic0: detector.topic0 },
    },
    severity: { ruleId: severity.ruleId, inputs: severity.inputs, result: severity.severity },
    upgradeInvestigation,
    investigationReceipt,
    observedFacts,
    sources,
    errors,
  };

  const alert: Alert = {
    id: alertId,
    scanId: "",
    targetId: config.target.id,
    incidentClass: detector.incidentClass,
    eventType: upgradedEventType,
    classificationLabel: detector.classificationLabel,
    severity: severity.severity,
    severityRuleId: severity.ruleId,
    title: "Configured Aave Pool proxy implementation updated",
    summary: `The configured Pool proxy emitted ${detector.eventSignature}. The decoded implementation is ${implementation}. The ${severity.ruleId} policy rule classified this alert as ${severity.severity}.`,
    investigation: explainEvidence(evidence),
    observedAt: blockVerified ? new Date(Number(block?.timestamp) * 1_000).toISOString() : null,
    evidenceStatus,
    evidenceId,
    sources,
  };

  return { alert, evidence, failures: scanFailures };
}

export async function scanApprovedRange(
  reader: ChainReader,
  config: TargetConfig,
  bounds: ScanBounds = {},
): Promise<ScanResult> {
  const fromBlock = bounds.fromBlock ?? BigInt(config.scan.fromBlock);
  const toBlock = bounds.toBlock ?? BigInt(config.scan.toBlock);
  const scanId = createScanId(config.network.chainId, config.target.id, fromBlock, toBlock);
  const invalidBounds = validateBounds(config, fromBlock, toBlock);
  if (invalidBounds) return failedResult(config, fromBlock, toBlock, invalidBounds);

  let chainId: number;
  try {
    chainId = await reader.getChainId();
  } catch (error) {
    return failedResult(config, fromBlock, toBlock, rpcFailure("chain-id-rpc", "The RPC chain ID could not be retrieved.", error));
  }
  if (chainId !== BASE_MAINNET_CHAIN_ID) {
    return failedResult(config, fromBlock, toBlock, {
      ...failure("rpc-chain-id-mismatch", "rpc", "The RPC endpoint is not Base mainnet chain ID 8453."),
      category: "wrong-chain",
    });
  }

  let latestBlock: bigint;
  try {
    latestBlock = await reader.getLatestBlockNumber();
  } catch (error) {
    return failedResult(config, fromBlock, toBlock, rpcFailure("latest-block-rpc", "The latest Base block could not be retrieved.", error));
  }

  const confirmations = BigInt(config.scan.minimumConfirmations);
  if (latestBlock < toBlock || latestBlock - toBlock < confirmations) {
    return failedResult(config, fromBlock, toBlock, failure("insufficient-confirmations", "validation", "The approved end block does not have the configured confirmations."));
  }

  const detector = config.detectors[0];
  const address = detector.contractAddresses[0] as Address;
  const chunkSize = BigInt(config.scan.chunkSize);
  const candidateLogs: ChainLog[] = [];
  const failures: ScanFailure[] = [];
  let successfulChunks = 0;

  for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += chunkSize) {
    const chunkEnd = chunkStart + chunkSize - 1n > toBlock ? toBlock : chunkStart + chunkSize - 1n;
    try {
      const batch = await reader.getLogs({ address, topic0: detector.topic0, fromBlock: chunkStart, toBlock: chunkEnd });
      successfulChunks += 1;
      for (const malformed of batch.malformed) {
        failures.push({ ...malformed, stage: "rpc", category: "malformed-response" });
      }
      for (const log of batch.logs) {
        if (!exactScope(log, address, detector.topic0, chunkStart, chunkEnd)) {
          failures.push(failure("rpc-log-outside-approved-filter", "rpc", "Base RPC returned a log outside the approved address, topic, or block filter.", log));
          continue;
        }
        candidateLogs.push(log);
      }
    } catch (error) {
      failures.push(rpcFailure("log-chunk-rpc", "A bounded Base log chunk could not be retrieved.", error, {
        blockNumber: chunkStart.toString(),
      }));
    }
  }

  candidateLogs.sort((left, right) =>
    Number(left.blockNumber - right.blockNumber)
    || left.transactionIndex - right.transactionIndex
    || left.logIndex - right.logIndex);

  const caches: EvidenceCaches = { blocks: new Map(), transactions: new Map(), receipts: new Map() };
  const seenAlertIds = new Set<string>();
  const alerts: Alert[] = [];
  const evidence: Evidence[] = [];

  for (const log of candidateLogs) {
    let implementation: Address;
    try {
      implementation = decodeUpgradeLog(log.data, log.topics);
    } catch {
      failures.push(failure("strict-upgrade-decode-failed", "decode", "A log matching the approved filter could not be strictly decoded as Upgraded(address).", log));
      continue;
    }

    const alertId = createAlertId(config.network.chainId, log.transactionHash, log.logIndex, detector.id);
    if (seenAlertIds.has(alertId)) continue;
    seenAlertIds.add(alertId);

    const built = await buildEvidence(reader, config, log, implementation, caches);
    built.alert.scanId = scanId;
    alerts.push(built.alert);
    evidence.push(built.evidence);
    failures.push(...built.failures);
  }

  if (successfulChunks > 0) {
    for (const knownTransaction of config.scan.knownTransactions) {
      const matchingEvidence = evidence.find(({ transaction }) =>
        transaction.hash.toLowerCase() === knownTransaction.toLowerCase());
      if (!matchingEvidence) {
        failures.push({
          code: "known-upgrade-event-not-observed",
          stage: "evidence",
          category: "incomplete-evidence",
          message: "The configured known transaction did not produce a verified qualifying Upgraded(address) event.",
          transactionHash: knownTransaction,
        });
      } else if (matchingEvidence.status !== "complete") {
        failures.push({
          code: "known-transaction-evidence-incomplete",
          stage: "evidence",
          category: "incomplete-evidence",
          message: "The qualifying event from the configured known transaction does not have complete verified evidence.",
          transactionHash: knownTransaction,
        });
      }
    }
  }

  const status = successfulChunks === 0 ? "failed" : failures.length > 0 ? "partial" : "complete";
  return scanResultSchema.parse({
    scanId,
    targetId: config.target.id,
    range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
    status,
    alerts,
    evidence,
    failures,
  });
}
