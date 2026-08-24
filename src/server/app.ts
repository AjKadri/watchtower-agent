import { resolve } from "node:path";

import express, { type ErrorRequestHandler, type Express } from "express";
import { z } from "zod";

import type { ChainReader } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import { investigationReceiptSchema } from "../domain/schemas.js";
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
};

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

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  const store = dependencies.store ?? new ScanStore();
  const publicDirectory = dependencies.publicDirectory ?? resolve("public");

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

      const result = await scanApprovedRange(dependencies.reader, dependencies.config, {
        ...(parsed.data.fromBlock && { fromBlock: BigInt(parsed.data.fromBlock) }),
        ...(parsed.data.toBlock && { toBlock: BigInt(parsed.data.toBlock) }),
      });
      store.save(result);
      const invalidRange = result.failures.some(({ stage }) => stage === "validation");
      response.status(invalidRange ? 400 : 201).json(result);
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
