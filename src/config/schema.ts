import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected an Ethereum address");
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hash");
const topic = hash;
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected an unsigned decimal string");

const configuredAddressSchema = z.object({
  address,
  role: z.string().min(1),
});

const detectorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  incidentClass: z.enum(["ownership_admin", "upgrade_pause"]),
  eventName: z.string().min(1),
  eventSignature: z.string().min(1),
  topic0: topic,
  contractAddresses: z.array(address).min(1),
  abiFile: z.string().min(1),
  decodedTargetArgument: z.string().min(1),
});

const severityRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  severity: z.enum(["high", "suspicious", "informational"]),
  condition: z.enum([
    "target-is-zero-address",
    "target-is-not-approved",
    "target-is-approved",
  ]),
});

const severityExampleSchema = z.object({
  severity: z.enum(["high", "suspicious", "informational"]),
  ruleId: z.string().min(1),
  kind: z.enum(["verified-onchain", "counterfactual-policy"]),
  targetAddress: address,
  transactionHash: hash.optional(),
  note: z.string().min(1),
});

export const targetConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    network: z.object({
      name: z.literal("base-mainnet"),
      chainId: z.literal(8453),
      explorerBaseUrl: z.url(),
    }),
    target: z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1),
      primaryContract: configuredAddressSchema,
      relatedContracts: z.array(configuredAddressSchema),
    }),
    scan: z.object({
      fromBlock: decimalString,
      toBlock: decimalString,
      maxBlockSpan: decimalString,
      chunkSize: decimalString,
      minimumConfirmations: decimalString,
      knownTransactions: z.array(hash).min(1),
    }),
    supportedIncidentClasses: z.array(z.enum(["ownership_admin", "upgrade_pause"])).min(1),
    excludedIncidentClasses: z.array(
      z.object({
        id: z.enum(["large_movement", "pause_unpause"]),
        reason: z.string().min(1),
      }),
    ),
    detectors: z.array(detectorSchema).min(1),
    severityPolicy: z.object({
      approvedTargetAddresses: z.array(address).min(1),
      rules: z.array(severityRuleSchema).length(3),
      examples: z.array(severityExampleSchema).length(3),
    }),
    verification: z.object({
      verifiedAt: z.iso.date(),
      transactionUrl: z.url(),
      blockUrl: z.url(),
      addressBookUrl: z.url(),
    }),
  })
  .superRefine((config, context) => {
    const fromBlock = BigInt(config.scan.fromBlock);
    const toBlock = BigInt(config.scan.toBlock);
    const maxBlockSpan = BigInt(config.scan.maxBlockSpan);

    if (fromBlock > toBlock) {
      context.addIssue({ code: "custom", path: ["scan"], message: "fromBlock must not exceed toBlock" });
    }

    if (toBlock - fromBlock + 1n > maxBlockSpan) {
      context.addIssue({ code: "custom", path: ["scan", "maxBlockSpan"], message: "scan range exceeds maxBlockSpan" });
    }

    const detectorIds = config.detectors.map(({ id }) => id);
    if (new Set(detectorIds).size !== detectorIds.length) {
      context.addIssue({ code: "custom", path: ["detectors"], message: "detector IDs must be unique" });
    }

    const ruleIds = new Set(config.severityPolicy.rules.map(({ id }) => id));
    const exampleSeverities = new Set(config.severityPolicy.examples.map(({ severity }) => severity));
    for (const example of config.severityPolicy.examples) {
      if (!ruleIds.has(example.ruleId)) {
        context.addIssue({ code: "custom", path: ["severityPolicy", "examples"], message: `unknown rule ID ${example.ruleId}` });
      }
    }
    for (const severity of ["high", "suspicious", "informational"] as const) {
      if (!exampleSeverities.has(severity)) {
        context.addIssue({ code: "custom", path: ["severityPolicy", "examples"], message: `missing ${severity} example` });
      }
    }
  });

export type TargetConfig = z.infer<typeof targetConfigSchema>;
