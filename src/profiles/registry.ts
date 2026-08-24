import { z } from "zod";

import { EVM_ADDRESS_PATTERN, evmAwareEqual, normalizeEvmAddress } from "../evm/address.js";

const address = z.string().regex(EVM_ADDRESS_PATTERN, "expected an Ethereum address").transform(normalizeEvmAddress);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hash");
const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, "expected even-length hex data");
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const targetProfileIdSchema = z.enum([
  "aave-v3-base-core",
  "compound-iii-base-usdc-comet",
  "etherfi-base-weeth-oft",
]);

export const investigationCheckIdSchema = z.enum([
  "implementation-before",
  "implementation-at-upgrade",
  "implementation-bytecode",
  "configured-pool",
  "pool-revision-before",
  "pool-revision-at-upgrade",
  "governor-before",
  "governor-at-upgrade",
  "base-token-at-upgrade",
  "endpoint-at-upgrade",
  "token-at-upgrade",
  "shared-decimals-at-upgrade",
]);

export const investigationCapabilitySchema = z.enum([
  "historical-storage-read",
  "historical-code-read",
  "historical-contract-call",
]);

const capabilityBudgetSchema = z.object({
  maximumReads: z.number().int().min(0).max(6),
  capabilities: z.array(z.object({
    name: investigationCapabilitySchema,
    maximumUses: z.number().int().min(1).max(6),
  }).strict()).max(3),
}).strict();

export const registeredInvestigationPlanSchema = z.object({
  id: z.enum(["corroborate-approved-upgrade", "escalate-unapproved-upgrade", "stop-incomplete"]),
  version: z.literal("1.0.0"),
  selectionReason: z.object({
    code: z.enum(["approved-target", "unapproved-target", "trigger-evidence-incomplete"]),
    text: z.string().min(1),
  }).strict(),
  selectedChecks: z.array(investigationCheckIdSchema).max(6),
  skippedChecks: z.array(investigationCheckIdSchema).max(6),
  capabilityBudget: capabilityBudgetSchema,
}).strict();

const commonCheckFields = {
  id: investigationCheckIdSchema,
  required: z.boolean(),
  block: z.enum(["previous", "upgrade"]),
  description: z.string().min(1),
};

export const profileInvestigationCheckSchema = z.discriminatedUnion("kind", [
  z.object({
    ...commonCheckFields,
    kind: z.literal("storage-address"),
    method: z.literal("eth_getStorageAt"),
    capability: z.literal("historical-storage-read"),
    address: address,
    slot: hash,
    expectedAddress: address,
    mustMatchDecodedImplementation: z.boolean(),
  }).strict(),
  z.object({
    ...commonCheckFields,
    kind: z.literal("implementation-code"),
    method: z.literal("eth_getCode"),
    capability: z.literal("historical-code-read"),
    addressSource: z.literal("decoded-implementation"),
    expectedApprovedImplementation: address,
    expectedByteLength: decimalString,
  }).strict(),
  z.object({
    ...commonCheckFields,
    kind: z.literal("call-address"),
    method: z.literal("eth_call"),
    capability: z.literal("historical-contract-call"),
    to: address,
    data: hex,
    expectedAddress: address,
  }).strict(),
  z.object({
    ...commonCheckFields,
    kind: z.literal("call-uint256"),
    method: z.literal("eth_call"),
    capability: z.literal("historical-contract-call"),
    to: address,
    data: hex,
    expectedValue: decimalString,
  }).strict(),
]);

const detectorSchema = z.object({
  id: z.string().min(1),
  incidentClass: z.literal("contract_upgrade"),
  classificationLabel: z.literal("Contract upgrade"),
  eventName: z.literal("Upgraded"),
  eventSignature: z.literal("Upgraded(address)"),
  topic0: z.literal("0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b"),
  contractAddresses: z.array(address).length(1),
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
}).strict();

const targetProfileBaseSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: targetProfileIdSchema,
  protocol: z.object({ name: z.string().min(1), product: z.string().min(1) }).strict(),
  network: z.object({
    name: z.literal("base-mainnet"),
    chainId: z.literal(8453),
    explorerBaseUrl: z.literal("https://basescan.org"),
  }).strict(),
  target: z.object({
    id: targetProfileIdSchema,
    name: z.string().min(1),
    primaryContract: z.object({ address, role: z.string().min(1) }).strict(),
    relatedContracts: z.array(z.object({
      key: z.string().regex(/^[a-z][a-z0-9-]*$/),
      address,
      role: z.string().min(1),
    }).strict()).max(8),
  }).strict(),
  scan: z.object({
    fromBlock: decimalString,
    toBlock: decimalString,
    maxBlockSpan: z.literal("1"),
    chunkSize: z.literal("1"),
    minimumConfirmations: z.literal("20"),
    knownTransactions: z.array(hash).length(1),
  }).strict(),
  investigation: z.object({
    previousBlock: decimalString,
    upgradeBlock: decimalString,
    implementationSlot: z.literal("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"),
    checks: z.array(profileInvestigationCheckSchema).length(6),
  }).strict(),
  plans: z.object({
    approved: registeredInvestigationPlanSchema,
    escalation: registeredInvestigationPlanSchema,
    incomplete: registeredInvestigationPlanSchema,
  }).strict(),
  supportedIncidentClasses: z.array(z.literal("contract_upgrade")).length(1),
  excludedIncidentClasses: z.array(z.object({
    id: z.enum(["ownership_admin", "large_movement", "pause_unpause"]),
    reason: z.string().min(1),
  }).strict()).length(3),
  detectors: z.array(detectorSchema).length(1),
  severityPolicy: z.object({
    approvedTargetAddresses: z.array(address).length(1),
    rules: z.array(z.object({
      id: z.enum(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]),
      severity: z.enum(["high", "suspicious", "informational"]),
      condition: z.enum(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]),
    }).strict()).length(3),
    examples: z.array(severityExampleSchema).length(3),
  }).strict(),
  expectedFixture: z.object({
    status: z.enum(["committed", "pending"]),
    path: z.string().min(1).nullable(),
    verifiedAt: z.iso.date(),
    logIndex: decimalString,
    transactionStatus: z.literal("success"),
    implementationBefore: address,
    implementationAfter: address,
    implementationByteLength: decimalString,
  }).strict(),
  explorerLinks: z.object({
    transaction: z.url(),
    block: z.url(),
    primaryContract: z.url(),
    implementation: z.url(),
    reference: z.url(),
  }).strict(),
  presentation: z.object({
    observedEmitterName: z.string().min(1),
    alertTitle: z.string().min(1),
    summarySubject: z.string().min(1),
  }).strict(),
}).strict().superRefine((profile, context) => {
  if (profile.profileId !== profile.target.id) {
    context.addIssue({ code: "custom", path: ["target", "id"], message: "target ID must match profile ID" });
  }
  if (profile.scan.fromBlock !== profile.scan.toBlock || profile.scan.toBlock !== profile.investigation.upgradeBlock) {
    context.addIssue({ code: "custom", path: ["scan"], message: "profile scan must be the single configured upgrade block" });
  }
  if (BigInt(profile.investigation.previousBlock) + 1n !== BigInt(profile.investigation.upgradeBlock)) {
    context.addIssue({ code: "custom", path: ["investigation", "previousBlock"], message: "previous block must be N-1" });
  }
  if (profile.detectors[0]?.contractAddresses[0] !== profile.target.primaryContract.address) {
    context.addIssue({ code: "custom", path: ["detectors", 0, "contractAddresses"], message: "detector must target the primary proxy" });
  }
  if (profile.scan.knownTransactions[0] !== profile.explorerLinks.transaction.split("/").at(-1)) {
    context.addIssue({ code: "custom", path: ["explorerLinks", "transaction"], message: "transaction explorer link must match the qualifying transaction" });
  }
  if (profile.expectedFixture.implementationAfter !== profile.severityPolicy.approvedTargetAddresses[0]) {
    context.addIssue({ code: "custom", path: ["severityPolicy", "approvedTargetAddresses"], message: "approved target must match expected implementation" });
  }
  const checkIds = profile.investigation.checks.map(({ id }) => id);
  if (new Set(checkIds).size !== checkIds.length) {
    context.addIssue({ code: "custom", path: ["investigation", "checks"], message: "profile check IDs must be unique" });
  }
  for (const plan of Object.values(profile.plans)) {
    const planned = [...plan.selectedChecks, ...plan.skippedChecks];
    if (planned.length !== checkIds.length || planned.some((id) => !checkIds.includes(id))) {
      context.addIssue({ code: "custom", path: ["plans"], message: "every plan must partition the profile check IDs" });
    }
  }
});

type ProfileInput = z.input<typeof targetProfileBaseSchema>;
export type TargetProfile = z.output<typeof targetProfileBaseSchema>;
export type TargetProfileId = z.infer<typeof targetProfileIdSchema>;
export type ProfileInvestigationCheck = z.infer<typeof profileInvestigationCheckSchema>;
export type RegisteredInvestigationPlan = z.infer<typeof registeredInvestigationPlanSchema>;

const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const UPGRADED_TOPIC = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";

function basePlans(
  selectedChecks: Array<z.input<typeof investigationCheckIdSchema>>,
  escalationChecks: Array<z.input<typeof investigationCheckIdSchema>>,
): ProfileInput["plans"] {
  const skippedEscalation = selectedChecks.filter((id) => !escalationChecks.includes(id));
  return {
    approved: {
      id: "corroborate-approved-upgrade",
      version: "1.0.0",
      selectionReason: {
        code: "approved-target",
        text: "The deterministic severity rule identified the decoded implementation as the configured approved target.",
      },
      selectedChecks,
      skippedChecks: [],
      capabilityBudget: {
        maximumReads: 6,
        capabilities: [
          { name: "historical-storage-read", maximumUses: 2 },
          { name: "historical-code-read", maximumUses: 1 },
          { name: "historical-contract-call", maximumUses: 3 },
        ],
      },
    },
    escalation: {
      id: "escalate-unapproved-upgrade",
      version: "1.0.0",
      selectionReason: {
        code: "unapproved-target",
        text: "The deterministic severity rule identified a zero or unapproved decoded implementation.",
      },
      selectedChecks: escalationChecks,
      skippedChecks: skippedEscalation,
      capabilityBudget: {
        maximumReads: 4,
        capabilities: [
          { name: "historical-storage-read", maximumUses: 2 },
          { name: "historical-code-read", maximumUses: 1 },
          { name: "historical-contract-call", maximumUses: 1 },
        ],
      },
    },
    incomplete: {
      id: "stop-incomplete",
      version: "1.0.0",
      selectionReason: {
        code: "trigger-evidence-incomplete",
        text: "Complete trigger evidence is unavailable, so no historical investigation reads are permitted.",
      },
      selectedChecks: [],
      skippedChecks: selectedChecks,
      capabilityBudget: { maximumReads: 0, capabilities: [] },
    },
  };
}

function severityPolicy(implementation: string, transactionHash: string): ProfileInput["severityPolicy"] {
  return {
    approvedTargetAddresses: [implementation],
    rules: [
      { id: "target-is-zero-address", severity: "high", condition: "target-is-zero-address" },
      { id: "target-is-not-approved", severity: "suspicious", condition: "target-is-not-approved" },
      { id: "target-is-approved", severity: "informational", condition: "target-is-approved" },
    ],
    examples: [
      {
        severity: "high",
        ruleId: "target-is-zero-address",
        kind: "counterfactual-policy",
        targetAddress: "0x0000000000000000000000000000000000000000",
        note: "A supported update whose decoded target is the zero address.",
      },
      {
        severity: "suspicious",
        ruleId: "target-is-not-approved",
        kind: "counterfactual-policy",
        targetAddress: "0x1111111111111111111111111111111111111111",
        note: "A supported update whose decoded target is neither zero nor approved.",
      },
      {
        severity: "informational",
        ruleId: "target-is-approved",
        kind: "verified-onchain",
        targetAddress: implementation,
        transactionHash,
        note: "The verified proxy implementation target matches the approved address.",
      },
    ],
  };
}

function commonChecks(input: {
  proxy: string;
  implementationBefore: string;
  implementationAfter: string;
  implementationByteLength: string;
}): ProfileInput["investigation"]["checks"] {
  return [
    {
      id: "implementation-before",
      required: true,
      kind: "storage-address",
      method: "eth_getStorageAt",
      capability: "historical-storage-read",
      block: "previous",
      address: input.proxy,
      slot: IMPLEMENTATION_SLOT,
      expectedAddress: input.implementationBefore,
      mustMatchDecodedImplementation: false,
      description: "The configured proxy implementation slot at N-1 matches the verified pre-upgrade implementation.",
    },
    {
      id: "implementation-at-upgrade",
      required: true,
      kind: "storage-address",
      method: "eth_getStorageAt",
      capability: "historical-storage-read",
      block: "upgrade",
      address: input.proxy,
      slot: IMPLEMENTATION_SLOT,
      expectedAddress: input.implementationAfter,
      mustMatchDecodedImplementation: true,
      description: "The configured proxy implementation slot at N matches both the approved and decoded implementation.",
    },
    {
      id: "implementation-bytecode",
      required: true,
      kind: "implementation-code",
      method: "eth_getCode",
      capability: "historical-code-read",
      block: "upgrade",
      addressSource: "decoded-implementation",
      expectedApprovedImplementation: input.implementationAfter,
      expectedByteLength: input.implementationByteLength,
      description: "The decoded implementation has the verified deployed bytecode length at N.",
    },
  ];
}

const aaveProxy = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const aaveProvider = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";
const aaveTransaction = "0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a";
const aaveImplementation = "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4";

const compoundProxy = "0xb125E6687d4313864e53df431d5425969c15Eb2F";
const compoundTransaction = "0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4";
const compoundImplementation = "0x89e9b098bb0e3d09f4288fb2b9632b4dcb40bbf6";

const etherfiProxy = "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A";
const etherfiTransaction = "0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2";
const etherfiImplementation = "0xde8A2C33655ACA88f258988ED74D1511876343D1";

const rawProfiles: Record<TargetProfileId, ProfileInput> = {
  "aave-v3-base-core": {
    schemaVersion: 1,
    profileId: "aave-v3-base-core",
    protocol: { name: "Aave V3", product: "Base Pool" },
    network: { name: "base-mainnet", chainId: 8453, explorerBaseUrl: "https://basescan.org" },
    target: {
      id: "aave-v3-base-core",
      name: "Aave V3 Base core",
      primaryContract: { address: aaveProxy, role: "pool-proxy" },
      relatedContracts: [{ key: "provider", address: aaveProvider, role: "pool-addresses-provider" }],
    },
    scan: {
      fromBlock: "41105890",
      toBlock: "41105890",
      maxBlockSpan: "1",
      chunkSize: "1",
      minimumConfirmations: "20",
      knownTransactions: [aaveTransaction],
    },
    investigation: {
      previousBlock: "41105889",
      upgradeBlock: "41105890",
      implementationSlot: IMPLEMENTATION_SLOT,
      checks: [
        ...commonChecks({
          proxy: aaveProxy,
          implementationBefore: "0x79ab8fc5ba13daf37b4e978a543286bc2a16508c",
          implementationAfter: aaveImplementation,
          implementationByteLength: "22757",
        }),
        {
          id: "configured-pool",
          required: true,
          kind: "call-address",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: aaveProvider,
          data: "0x026b1d5f",
          expectedAddress: aaveProxy,
          description: "The configured PoolAddressesProvider returns the configured Pool proxy at N.",
        },
        {
          id: "pool-revision-before",
          required: false,
          kind: "call-uint256",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "previous",
          to: aaveProxy,
          data: "0x0148170e",
          expectedValue: "9",
          description: "Optional POOL_REVISION() corroboration at N-1 matches the verified fixture.",
        },
        {
          id: "pool-revision-at-upgrade",
          required: false,
          kind: "call-uint256",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: aaveProxy,
          data: "0x0148170e",
          expectedValue: "10",
          description: "Optional POOL_REVISION() corroboration at N matches the verified fixture.",
        },
      ],
    },
    plans: basePlans(
      ["implementation-before", "implementation-at-upgrade", "implementation-bytecode", "configured-pool", "pool-revision-before", "pool-revision-at-upgrade"],
      ["implementation-before", "implementation-at-upgrade", "implementation-bytecode", "configured-pool"],
    ),
    supportedIncidentClasses: ["contract_upgrade"],
    excludedIncidentClasses: [
      { id: "ownership_admin", reason: "The profile is limited to the configured Pool proxy upgrade event." },
      { id: "large_movement", reason: "The qualifying transaction does not provide a representative large-transfer fixture." },
      { id: "pause_unpause", reason: "The qualifying transaction does not contain a verified pause or unpause event." },
    ],
    detectors: [{
      id: "aave-pool-upgraded",
      incidentClass: "contract_upgrade",
      classificationLabel: "Contract upgrade",
      eventName: "Upgraded",
      eventSignature: "Upgraded(address)",
      topic0: UPGRADED_TOPIC,
      contractAddresses: [aaveProxy],
      abiFile: "config/abis/aave-base-upgrade-events.json",
      decodedTargetArgument: "implementation",
    }],
    severityPolicy: severityPolicy(aaveImplementation, aaveTransaction),
    expectedFixture: {
      status: "committed",
      path: "fixtures/base/aave-v3-upgrade-41105890",
      verifiedAt: "2026-08-22",
      logIndex: "641",
      transactionStatus: "success",
      implementationBefore: "0x79ab8fc5ba13daf37b4e978a543286bc2a16508c",
      implementationAfter: aaveImplementation,
      implementationByteLength: "22757",
    },
    explorerLinks: {
      transaction: `https://basescan.org/tx/${aaveTransaction}`,
      block: "https://basescan.org/block/41105890",
      primaryContract: `https://basescan.org/address/${aaveProxy}`,
      implementation: `https://basescan.org/address/${aaveImplementation}`,
      reference: "https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol",
    },
    presentation: {
      observedEmitterName: "Aave V3 Base Pool proxy",
      alertTitle: "Configured Aave Pool proxy implementation updated",
      summarySubject: "Pool proxy",
    },
  },
  "compound-iii-base-usdc-comet": {
    schemaVersion: 1,
    profileId: "compound-iii-base-usdc-comet",
    protocol: { name: "Compound III", product: "Base USDC Comet" },
    network: { name: "base-mainnet", chainId: 8453, explorerBaseUrl: "https://basescan.org" },
    target: {
      id: "compound-iii-base-usdc-comet",
      name: "Compound III Base USDC Comet",
      primaryContract: { address: compoundProxy, role: "comet-proxy" },
      relatedContracts: [
        { key: "configurator", address: "0x45939657d1CA34A8FA39A924B71D28Fe8431e581", role: "configurator" },
        { key: "rewards", address: "0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1", role: "rewards" },
        { key: "bridge-receiver", address: "0x18281dfC4d00905DA1aaA6731414EABa843c468A", role: "bridge-receiver" },
        { key: "proxy-admin", address: "0xbdE8F31D2DdDA895264e27DD990faB3DC87b372d", role: "proxy-admin" },
        { key: "governor", address: "0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02", role: "local-governor-timelock" },
        { key: "base-token", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", role: "base-usdc" },
      ],
    },
    scan: {
      fromBlock: "40235590",
      toBlock: "40235590",
      maxBlockSpan: "1",
      chunkSize: "1",
      minimumConfirmations: "20",
      knownTransactions: [compoundTransaction],
    },
    investigation: {
      previousBlock: "40235589",
      upgradeBlock: "40235590",
      implementationSlot: IMPLEMENTATION_SLOT,
      checks: [
        ...commonChecks({
          proxy: compoundProxy,
          implementationBefore: "0xd84933745943df8edc45ff0f0ef7bd55324a22b6",
          implementationAfter: compoundImplementation,
          implementationByteLength: "18599",
        }),
        {
          id: "governor-before",
          required: true,
          kind: "call-address",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "previous",
          to: compoundProxy,
          data: "0x0c340a24",
          expectedAddress: "0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02",
          description: "The configured Comet governor at N-1 matches the verified local governor.",
        },
        {
          id: "governor-at-upgrade",
          required: true,
          kind: "call-address",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: compoundProxy,
          data: "0x0c340a24",
          expectedAddress: "0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02",
          description: "The configured Comet governor at N matches the verified local governor.",
        },
        {
          id: "base-token-at-upgrade",
          required: true,
          kind: "call-address",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: compoundProxy,
          data: "0xc55dae63",
          expectedAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          description: "The configured Comet baseToken() at N matches Base USDC.",
        },
      ],
    },
    plans: basePlans(
      ["implementation-before", "implementation-at-upgrade", "implementation-bytecode", "governor-before", "governor-at-upgrade", "base-token-at-upgrade"],
      ["implementation-before", "implementation-at-upgrade", "implementation-bytecode", "governor-before"],
    ),
    supportedIncidentClasses: ["contract_upgrade"],
    excludedIncidentClasses: [
      { id: "ownership_admin", reason: "The profile records fixed identity checks but does not detect administrative changes." },
      { id: "large_movement", reason: "Large movements are outside the approved profile." },
      { id: "pause_unpause", reason: "Pause and unpause events are outside the approved profile." },
    ],
    detectors: [{
      id: "compound-comet-upgraded",
      incidentClass: "contract_upgrade",
      classificationLabel: "Contract upgrade",
      eventName: "Upgraded",
      eventSignature: "Upgraded(address)",
      topic0: UPGRADED_TOPIC,
      contractAddresses: [compoundProxy],
      abiFile: "config/abis/aave-base-upgrade-events.json",
      decodedTargetArgument: "implementation",
    }],
    severityPolicy: severityPolicy(compoundImplementation, compoundTransaction),
    expectedFixture: {
      status: "committed",
      path: "fixtures/base/compound-iii-usdc-upgrade-40235590",
      verifiedAt: "2026-08-24",
      logIndex: "270",
      transactionStatus: "success",
      implementationBefore: "0xd84933745943df8edc45ff0f0ef7bd55324a22b6",
      implementationAfter: compoundImplementation,
      implementationByteLength: "18599",
    },
    explorerLinks: {
      transaction: `https://basescan.org/tx/${compoundTransaction}`,
      block: "https://basescan.org/block/40235590",
      primaryContract: `https://basescan.org/address/${compoundProxy}`,
      implementation: `https://basescan.org/address/${compoundImplementation}`,
      reference: "https://github.com/compound-finance/comet/blob/main/deployments/base/usdc/roots.json",
    },
    presentation: {
      observedEmitterName: "Compound III Base USDC Comet proxy",
      alertTitle: "Configured Compound Comet proxy implementation updated",
      summarySubject: "Comet proxy",
    },
  },
  "etherfi-base-weeth-oft": {
    schemaVersion: 1,
    profileId: "etherfi-base-weeth-oft",
    protocol: { name: "ether.fi", product: "Base weETH OFT" },
    network: { name: "base-mainnet", chainId: 8453, explorerBaseUrl: "https://basescan.org" },
    target: {
      id: "etherfi-base-weeth-oft",
      name: "ether.fi Base weETH OFT",
      primaryContract: { address: etherfiProxy, role: "weeth-oft-proxy" },
      relatedContracts: [
        { key: "sync-pool", address: "0xc38e046dFDAdf15f7F56853674242888301208a5", role: "base-sync-pool" },
        { key: "proxy-admin", address: "0x2f6f3cc4a275c7951fb79199f01ed82421edfb68", role: "proxy-admin" },
        { key: "layerzero-endpoint", address: "0x1a44076050125825900e736c501f859c50fE728c", role: "layerzero-v2-endpoint" },
      ],
    },
    scan: {
      fromBlock: "23487559",
      toBlock: "23487559",
      maxBlockSpan: "1",
      chunkSize: "1",
      minimumConfirmations: "20",
      knownTransactions: [etherfiTransaction],
    },
    investigation: {
      previousBlock: "23487558",
      upgradeBlock: "23487559",
      implementationSlot: IMPLEMENTATION_SLOT,
      checks: [
        ...commonChecks({
          proxy: etherfiProxy,
          implementationBefore: "0x20EE00F43Ef299dba82BA6FEF537756DaBE38CC7",
          implementationAfter: etherfiImplementation,
          implementationByteLength: "17594",
        }),
        {
          id: "endpoint-at-upgrade",
          required: true,
          kind: "call-address",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: etherfiProxy,
          data: "0x5e280f11",
          expectedAddress: "0x1a44076050125825900e736c501f859c50fE728c",
          description: "The configured weETH OFT endpoint() at N matches the approved LayerZero V2 endpoint.",
        },
        {
          id: "token-at-upgrade",
          required: true,
          kind: "call-address",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: etherfiProxy,
          data: "0xfc0c546a",
          expectedAddress: etherfiProxy,
          description: "The configured weETH OFT token() at N resolves to the approved proxy.",
        },
        {
          id: "shared-decimals-at-upgrade",
          required: true,
          kind: "call-uint256",
          method: "eth_call",
          capability: "historical-contract-call",
          block: "upgrade",
          to: etherfiProxy,
          data: "0x857749b0",
          expectedValue: "6",
          description: "The configured weETH OFT sharedDecimals() at N matches the verified value.",
        },
      ],
    },
    plans: basePlans(
      ["implementation-before", "implementation-at-upgrade", "implementation-bytecode", "endpoint-at-upgrade", "token-at-upgrade", "shared-decimals-at-upgrade"],
      ["implementation-before", "implementation-at-upgrade", "implementation-bytecode", "endpoint-at-upgrade"],
    ),
    supportedIncidentClasses: ["contract_upgrade"],
    excludedIncidentClasses: [
      { id: "ownership_admin", reason: "The profile records fixed identity checks but does not detect administrative changes." },
      { id: "large_movement", reason: "Cross-chain token movements are outside the approved profile." },
      { id: "pause_unpause", reason: "Pause and unpause events are outside the approved profile." },
    ],
    detectors: [{
      id: "etherfi-weeth-oft-upgraded",
      incidentClass: "contract_upgrade",
      classificationLabel: "Contract upgrade",
      eventName: "Upgraded",
      eventSignature: "Upgraded(address)",
      topic0: UPGRADED_TOPIC,
      contractAddresses: [etherfiProxy],
      abiFile: "config/abis/aave-base-upgrade-events.json",
      decodedTargetArgument: "implementation",
    }],
    severityPolicy: severityPolicy(etherfiImplementation, etherfiTransaction),
    expectedFixture: {
      status: "committed",
      path: "fixtures/base/etherfi-weeth-oft-upgrade-23487559",
      verifiedAt: "2026-08-24",
      logIndex: "190",
      transactionStatus: "success",
      implementationBefore: "0x20EE00F43Ef299dba82BA6FEF537756DaBE38CC7",
      implementationAfter: etherfiImplementation,
      implementationByteLength: "17594",
    },
    explorerLinks: {
      transaction: `https://basescan.org/tx/${etherfiTransaction}`,
      block: "https://basescan.org/block/23487559",
      primaryContract: `https://basescan.org/address/${etherfiProxy}`,
      implementation: `https://basescan.org/address/${etherfiImplementation}`,
      reference: "https://github.com/etherfi-protocol/weETH-cross-chain",
    },
    presentation: {
      observedEmitterName: "ether.fi Base weETH OFT proxy",
      alertTitle: "Configured ether.fi weETH OFT proxy implementation updated",
      summarySubject: "weETH OFT proxy",
    },
  },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const registry = Object.fromEntries(
  Object.entries(rawProfiles).map(([id, profile]) => [id, deepFreeze(targetProfileBaseSchema.parse(profile))]),
) as Record<TargetProfileId, TargetProfile>;

export const targetProfileSchema = targetProfileBaseSchema.superRefine((profile, context) => {
  const canonical = registry[profile.profileId];
  if (!canonical || !evmAwareEqual(profile, canonical)) {
    context.addIssue({ code: "custom", message: "profile does not match the closed registered definition" });
  }
});

export const targetProfileSelectionSchema = z.object({ profileId: targetProfileIdSchema }).strict();

export function getTargetProfile(profileId: unknown): TargetProfile {
  const id = targetProfileIdSchema.parse(profileId);
  return registry[id];
}

export function resolveTargetProfile(selection: unknown): TargetProfile {
  return getTargetProfile(targetProfileSelectionSchema.parse(selection).profileId);
}

export function listTargetProfiles(): TargetProfile[] {
  return targetProfileIdSchema.options.map((id) => registry[id]);
}

export function planForProfile(
  profile: TargetProfile,
  planId: RegisteredInvestigationPlan["id"],
): RegisteredInvestigationPlan {
  if (planId === "corroborate-approved-upgrade") return profile.plans.approved;
  if (planId === "escalate-unapproved-upgrade") return profile.plans.escalation;
  return profile.plans.incomplete;
}
