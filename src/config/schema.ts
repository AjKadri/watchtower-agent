import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected an Ethereum address");
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hash");

const detectorSchema = z.object({
  id: z.literal("aave-pool-upgraded"),
  incidentClass: z.literal("contract_upgrade"),
  classificationLabel: z.literal("Contract upgrade"),
  eventName: z.literal("Upgraded"),
  eventSignature: z.literal("Upgraded(address)"),
  topic0: z.literal("0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b"),
  contractAddresses: z.tuple([address]),
  abiFile: z.literal("config/abis/aave-base-upgrade-events.json"),
  decodedTargetArgument: z.literal("implementation"),
}).strict();

const severityExampleSchema = z.object({
  severity: z.enum(["high", "suspicious", "informational"]),
  ruleId: z.enum(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]),
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
    }).strict(),
    target: z.object({
      id: z.literal("aave-v3-base-core"),
      name: z.string().min(1),
      primaryContract: z.object({
        address: z.literal("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"),
        role: z.literal("pool-proxy"),
      }).strict(),
      relatedContracts: z.tuple([]),
    }).strict(),
    scan: z.object({
      fromBlock: z.literal("41105890"),
      toBlock: z.literal("41105890"),
      maxBlockSpan: z.literal("1"),
      chunkSize: z.literal("1"),
      minimumConfirmations: z.literal("20"),
      knownTransactions: z.tuple([
        z.literal("0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a"),
      ]),
    }).strict(),
    supportedIncidentClasses: z.tuple([z.literal("contract_upgrade")]),
    excludedIncidentClasses: z.tuple([
      z.object({
        id: z.literal("ownership_admin"),
        reason: z.string().min(1),
      }).strict(),
      z.object({
        id: z.literal("large_movement"),
        reason: z.string().min(1),
      }).strict(),
      z.object({
        id: z.literal("pause_unpause"),
        reason: z.string().min(1),
      }).strict(),
    ]),
    detectors: z.tuple([detectorSchema]),
    severityPolicy: z.object({
      approvedTargetAddresses: z.tuple([
        z.literal("0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4"),
      ]),
      rules: z.tuple([
        z.object({
          id: z.literal("target-is-zero-address"),
          severity: z.literal("high"),
          condition: z.literal("target-is-zero-address"),
        }).strict(),
        z.object({
          id: z.literal("target-is-not-approved"),
          severity: z.literal("suspicious"),
          condition: z.literal("target-is-not-approved"),
        }).strict(),
        z.object({
          id: z.literal("target-is-approved"),
          severity: z.literal("informational"),
          condition: z.literal("target-is-approved"),
        }).strict(),
      ]),
      examples: z.array(severityExampleSchema).length(3),
    }).strict(),
    verification: z.object({
      verifiedAt: z.iso.date(),
      transactionUrl: z.url(),
      blockUrl: z.url(),
      addressBookUrl: z.url(),
    }).strict(),
  }).strict()
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

    if (
      config.detectors[0].contractAddresses[0].toLowerCase() !==
      config.target.primaryContract.address.toLowerCase()
    ) {
      context.addIssue({ code: "custom", path: ["detectors", 0, "contractAddresses"], message: "detector must target the primary contract" });
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
