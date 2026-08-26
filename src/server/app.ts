import { resolve } from "node:path";

import express, { type ErrorRequestHandler, type Express } from "express";
import { z } from "zod";

import type { ChainReader } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import { investigationReceiptSchema, scanResultSchema, type ScanResult } from "../domain/schemas.js";
import { createScanId } from "../pipeline/ids.js";
import { scanApprovedRange } from "../pipeline/scanner.js";
import { ScanStore } from "./store.js";

const decimalBlock = z.string().regex(/^(0|[1-9][0-9]*)$/);
const scanRequestSchema = z.object({
  fromBlock: decimalBlock.optional(),
  toBlock: decimalBlock.optional(),
}).strict();
const scanIdSchema = z.string().regex(/^scan_[0-9a-f]{64}$/);
const alertIdSchema = z.string().regex(/^alert_[0-9a-f]{64}$/);
const receiptIdSchema = z.string().regex(/^receipt_[0-9a-f]{64}$/);

export type AppDependencies = {
  reader: ChainReader;
  config: TargetConfig;
  store?: ScanStore;
  publicDirectory?: string;
  scanDeadlineMs?: number;
};

export const DEFAULT_SCAN_DEADLINE_MS = 30_000;

let processScanActive = false;

function publicConfiguration(config: TargetConfig) {
  const detector = config.detectors[0];
  return {
    network: { name: config.network.name, chainId: config.network.chainId },
    profile: { id: config.profileId, protocol: config.protocol.name, product: config.protocol.product },
    target: {
      id: config.target.id,
      name: config.target.name,
      primaryContract: config.target.primaryContract,
      relatedContracts: config.target.relatedContracts.map(({ address, role }) => ({ address, role })),
    },
    scan: {
      fromBlock: config.scan.fromBlock,
      toBlock: config.scan.toBlock,
      minimumConfirmations: config.scan.minimumConfirmations,
    },
    detector: {
      id: detector.id,
      incidentClass: detector.incidentClass,
      classificationLabel: detector.classificationLabel,
      eventType: "proxy_upgraded",
      eventName: detector.eventName,
      eventSignature: detector.eventSignature,
      topic0: detector.topic0,
    },
    severityRules: config.severityPolicy.rules,
  };
}

const invalidScanRequestCodes = new Set([
  "invalid-range",
  "range-outside-approved-bounds",
  "range-too-large",
]);

export function scanHttpStatus(result: ScanResult): 200 | 201 | 400 | 502 | 503 {
  if (result.status === "complete") return 201;
  if (result.status === "partial") return 200;
  if (result.failures.some(({ code }) => invalidScanRequestCodes.has(code))) return 400;
  if (result.failures.some(({ category }) => category === "malformed-response" || category === "wrong-chain")) {
    return 502;
  }
  return 503;
}

function scanDeadlineResult(config: TargetConfig, fromBlock: bigint, toBlock: bigint): ScanResult {
  return scanResultSchema.parse({
    scanId: createScanId(config.network.chainId, config.target.id, fromBlock, toBlock),
    targetId: config.target.id,
    range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
    status: "failed",
    alerts: [],
    evidence: [],
    failures: [{
      code: "scan-deadline-timeout",
      stage: "rpc",
      category: "timeout",
      message: "The bounded scan exceeded its total execution deadline.",
    }],
  });
}

type DeadlineExecution = {
  result: ScanResult;
  cleanup: Promise<void>;
  timedOut: boolean;
};

async function runWithDeadline(
  operation: Promise<ScanResult>,
  controller: AbortController,
  deadlineMs: number,
  timeoutResult: ScanResult,
): Promise<DeadlineExecution> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const cleanup = operation.then(() => undefined, () => undefined);
  try {
    const result = await Promise.race([
      operation,
      new Promise<ScanResult>((resolveTimeout) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort(new DOMException("The total scan deadline elapsed.", "AbortError"));
          resolveTimeout(timeoutResult);
        }, deadlineMs);
      }),
    ]);
    return { result, cleanup, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  const store = dependencies.store ?? new ScanStore();
  const publicDirectory = dependencies.publicDirectory ?? resolve("public");
  const scanDeadlineMs = dependencies.scanDeadlineMs ?? DEFAULT_SCAN_DEADLINE_MS;
  if (!Number.isSafeInteger(scanDeadlineMs) || scanDeadlineMs <= 0) {
    throw new Error("The scan deadline must be a positive integer number of milliseconds.");
  }

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.use(express.json({ limit: "16kb", strict: false }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", network: "base-mainnet", targetId: dependencies.config.target.id });
  });

  app.get("/api/config", (_request, response) => {
    response.json(publicConfiguration(dependencies.config));
  });

  app.post("/api/scans", async (request, response, next) => {
    try {
      if (!request.is("application/json")) {
        response.status(415).json({
          error: { code: "content-type-required", message: "Scan requests require Content-Type: application/json." },
        });
        return;
      }

      const parsed = scanRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: { code: "invalid-scan-request", message: "The scan request may contain only decimal fromBlock and toBlock values." },
        });
        return;
      }

      if (processScanActive) {
        response.status(429).json({
          error: {
            code: "scan-already-running",
            message: "Another bounded scan is already running. Retry after it finishes.",
          },
        });
        return;
      }

      const fromBlock = parsed.data.fromBlock
        ? BigInt(parsed.data.fromBlock)
        : BigInt(dependencies.config.scan.fromBlock);
      const toBlock = parsed.data.toBlock
        ? BigInt(parsed.data.toBlock)
        : BigInt(dependencies.config.scan.toBlock);
      processScanActive = true;
      let releaseLockOnReturn = true;
      try {
        const controller = new AbortController();
        const execution = await runWithDeadline(
          scanApprovedRange(dependencies.reader, dependencies.config, { fromBlock, toBlock }, { signal: controller.signal }),
          controller,
          scanDeadlineMs,
          scanDeadlineResult(dependencies.config, fromBlock, toBlock),
        );
        store.save(execution.result);
        response.status(scanHttpStatus(execution.result)).json(execution.result);
        if (execution.timedOut) {
          releaseLockOnReturn = false;
          void execution.cleanup.finally(() => {
            processScanActive = false;
          });
        }
      } finally {
        if (releaseLockOnReturn) processScanActive = false;
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scans/:scanId", (request, response) => {
    const parsedId = scanIdSchema.safeParse(request.params.scanId);
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "invalid-scan-id", message: "The scan ID format is invalid." } });
      return;
    }
    const scan = store.getScan(parsedId.data);
    if (!scan) {
      response.status(404).json({ error: { code: "scan-not-found", message: "No in-memory scan has that ID." } });
      return;
    }
    response.json(scan);
  });

  app.get("/api/alerts", (_request, response) => {
    response.json({ alerts: store.listAlerts() });
  });

  app.get("/api/alerts/:alertId", (request, response) => {
    const parsedId = alertIdSchema.safeParse(request.params.alertId);
    if (!parsedId.success) {
      response.status(400).json({ error: { code: "invalid-alert-id", message: "The alert ID format is invalid." } });
      return;
    }
    const detail = store.getAlert(parsedId.data);
    if (!detail) {
      response.status(404).json({ error: { code: "alert-not-found", message: "No in-memory alert has that ID." } });
      return;
    }
    response.json(detail);
  });

  app.get("/api/receipts/:receiptId", (request, response, next) => {
    try {
      const parsedId = receiptIdSchema.safeParse(request.params.receiptId);
      if (!parsedId.success) {
        response.status(400).json({ error: { code: "invalid-receipt-id", message: "The receipt ID format is invalid." } });
        return;
      }
      const storedReceipt = store.getReceipt(parsedId.data);
      if (!storedReceipt) {
        response.status(404).json({ error: { code: "receipt-not-found", message: "No in-memory receipt has that ID." } });
        return;
      }
      const receipt = investigationReceiptSchema.parse(storedReceipt);
      response.set({
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="watchtower-${receipt.receiptId}.json"`,
      });
      response.json(receipt);
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(publicDirectory, { index: "index.html" }));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: { code: "route-not-found", message: "API route not found." } });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const invalidJson = error instanceof SyntaxError && "status" in error && error.status === 400;
    const tooLarge = error && typeof error === "object" && "status" in error && error.status === 413;
    const status = tooLarge ? 413 : invalidJson ? 400 : 500;
    response.status(status).json({
      error: {
        code: tooLarge ? "request-body-too-large" : invalidJson ? "invalid-json" : "internal-error",
        message: tooLarge
          ? "The request body exceeds the 16 KB limit."
          : invalidJson
            ? "The request body is not valid JSON."
            : "The request could not be completed.",
      },
    });
  };
  app.use(errorHandler);

  return app;
}
