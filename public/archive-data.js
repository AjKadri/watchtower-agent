const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const UPGRADED_TOPIC = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";
const LIMITATION = "This receipt records deterministic read-only checks for one configured historical upgrade and does not establish identity, intent, causality, or implementation safety.";

const capabilityBudget = {
  maximumReads: 6,
  capabilities: [
    { name: "historical-storage-read", maximumUses: 2 },
    { name: "historical-code-read", maximumUses: 1 },
    { name: "historical-contract-call", maximumUses: 3 },
  ],
};

function passedCheck({ id, required = true, method, parameters, blockTag, result, description, expected, actual = expected }) {
  return {
    id,
    required,
    method,
    parameters,
    blockTag,
    result,
    assertion: { description, expected, actual, matches: true },
    status: "passed",
    failure: null,
  };
}

function storageCheck(id, address, blockTag, value, description, matchesDecodedImplementation = false) {
  return passedCheck({
    id,
    method: "eth_getStorageAt",
    parameters: { address, slot: IMPLEMENTATION_SLOT },
    blockTag,
    result: { kind: "address", value },
    description,
    expected: value,
    matchesDecodedImplementation,
  });
}

function codeCheck(address, blockTag, byteLength, hash) {
  return passedCheck({
    id: "implementation-bytecode",
    method: "eth_getCode",
    parameters: { address },
    blockTag,
    result: { kind: "bytecode", present: true, byteLength, hash },
    description: "The decoded implementation has the verified deployed bytecode length at N.",
    expected: `${byteLength} bytes`,
  });
}

function callAddressCheck({ id, to, data, blockTag, value, description }) {
  return passedCheck({
    id,
    method: "eth_call",
    parameters: { to, data },
    blockTag,
    result: { kind: "address", value },
    description,
    expected: value,
  });
}

function callUintCheck({ id, required = true, to, data, blockTag, value, description }) {
  return passedCheck({
    id,
    required,
    method: "eth_call",
    parameters: { to, data },
    blockTag,
    result: { kind: "uint256", value },
    description,
    expected: value,
  });
}

function explorerLinks(profile) {
  return {
    transaction: `https://basescan.org/tx/${profile.transaction.hash}`,
    block: `https://basescan.org/block/${profile.block.number}`,
    addresses: Object.fromEntries(profile.addresses.map(({ key, address }) => [key, `https://basescan.org/address/${address}`])),
  };
}

function buildProfile(input) {
  const selectedChecks = input.checks.map(({ id }) => id);
  const plan = {
    id: "corroborate-approved-upgrade",
    version: "1.0.0",
    selectionReason: {
      code: "approved-target",
      text: "The deterministic severity rule identified the decoded implementation as the configured approved target.",
    },
    selectedChecks,
    skippedChecks: [],
    capabilityBudget,
  };
  const links = explorerLinks(input);
  const receipt = {
    receiptId: input.receiptId,
    schemaVersion: 1,
    trigger: {
      network: { name: "base-mainnet", chainId: 8453 },
      targetId: input.id,
      incidentClass: "contract_upgrade",
      eventType: "proxy_upgraded",
      eventSignature: "Upgraded(address)",
      decodedArguments: { implementation: input.implementation },
      block: input.block,
      transaction: { ...input.transaction, receiptStatus: "success" },
      log: {
        index: input.logIndex,
        emitter: input.emitter,
        topic0: UPGRADED_TOPIC,
        rawTopics: [UPGRADED_TOPIC, `0x${"0".repeat(24)}${input.implementation.slice(2).toLowerCase()}`],
      },
      detector: { id: input.detectorId, severityRuleId: "target-is-approved", severity: "informational" },
    },
    plan,
    checks: input.checks,
    errors: [],
    limitations: [LIMITATION, ...input.limitations],
    finalDisposition: "corroborated",
    explorerLinks: links,
  };
  return Object.freeze({ ...input, event: "Upgraded(address)", disposition: "corroborated", source: "verified-fixture", links, receipt });
}

const aaveProxy = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const aaveImplementation = "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4";
const aaveProvider = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";

const compoundProxy = "0xb125E6687d4313864e53df431d5425969c15Eb2F";
const compoundImplementation = "0x89e9b098bb0e3d09f4288fb2b9632b4dcb40bbf6";
const compoundGovernor = "0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02";
const compoundBaseToken = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const etherfiProxy = "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A";
const etherfiImplementation = "0xde8A2C33655ACA88f258988ED74D1511876343D1";
const layerZeroEndpoint = "0x1a44076050125825900e736c501f859c50fE728c";

export const archiveProfiles = Object.freeze([
  buildProfile({
    id: "aave-v3-base-core",
    displayName: "Aave V3 Base Pool",
    protocol: "Aave V3",
    product: "Base Pool",
    targetName: "Pool proxy",
    targetPurpose: "Base Pool implementation proxy",
    emitter: aaveProxy,
    implementation: aaveImplementation,
    detectorId: "aave-pool-upgraded",
    logIndex: "641",
    receiptId: "receipt_6aa4240b4705d61f1719342142541ca10d695f38e6c6df58576ce47d6c1d7e4b",
    block: { number: "41105890", hash: "0x3f8b9a19d39bdf97178f6f7e7117138ec5cb7c5fe292afcac914a250568428ff", timestamp: "2026-01-21T13:12:07.000Z" },
    transaction: { hash: "0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a", sender: "0xD7E21e6DEBb75cEB4FC9D73c09EA48625984B959", recipient: "0xE226D5aCae908252CcA3F6CEFa577527650a9e1e" },
    addresses: [
      { key: "emitter", address: aaveProxy, role: "pool-proxy" },
      { key: "implementation", address: aaveImplementation, role: "decoded-implementation" },
      { key: "provider", address: aaveProvider, role: "pool-addresses-provider" },
      { key: "sender", address: "0xD7E21e6DEBb75cEB4FC9D73c09EA48625984B959", role: "transaction-sender" },
      { key: "recipient", address: "0xE226D5aCae908252CcA3F6CEFa577527650a9e1e", role: "transaction-recipient" },
    ],
    checks: [
      storageCheck("implementation-before", aaveProxy, "0x27339e1", "0x79ab8FC5BA13DaF37b4e978a543286bc2A16508C", "The configured proxy implementation slot at N-1 matches the verified pre-upgrade implementation."),
      storageCheck("implementation-at-upgrade", aaveProxy, "0x27339e2", aaveImplementation, "The configured proxy implementation slot at N matches both the approved and decoded implementation.", true),
      codeCheck(aaveImplementation, "0x27339e2", "22757", "0x1c45cf4a2addf7674f53823c4a5cb2d1177c275cadf51eda88718488b81e3fe1"),
      callAddressCheck({ id: "configured-pool", to: aaveProvider, data: "0x026b1d5f", blockTag: "0x27339e2", value: aaveProxy, description: "The configured PoolAddressesProvider returns the configured Pool proxy at N." }),
      callUintCheck({ id: "pool-revision-before", required: false, to: aaveProxy, data: "0x0148170e", blockTag: "0x27339e1", value: "9", description: "Optional POOL_REVISION() corroboration at N-1 matches the verified fixture." }),
      callUintCheck({ id: "pool-revision-at-upgrade", required: false, to: aaveProxy, data: "0x0148170e", blockTag: "0x27339e2", value: "10", description: "Optional POOL_REVISION() corroboration at N matches the verified fixture." }),
    ],
    limitations: ["POOL_REVISION() is optional corroboration and does not control severity or final disposition."],
  }),
  buildProfile({
    id: "compound-iii-base-usdc-comet",
    displayName: "Compound III Base USDC Comet",
    protocol: "Compound III",
    product: "Base USDC Comet",
    targetName: "Comet proxy",
    targetPurpose: "Base USDC Comet implementation proxy",
    emitter: compoundProxy,
    implementation: compoundImplementation,
    detectorId: "compound-comet-upgraded",
    logIndex: "270",
    receiptId: "receipt_46851ad7a61c84e956533f7619f38e8d423e24ee198e8999c2157db9c2df9216",
    block: { number: "40235590", hash: "0x87b4a904a696c3620e48f69aca523712b20f87796b6124dc3bf1c60e059caf76", timestamp: "2026-01-01T09:42:07.000Z" },
    transaction: { hash: "0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4", sender: "0x9f771c534f12d711a91f1ad5bb8b4941b5252768", recipient: "0x18281dfc4d00905da1aaa6731414eaba843c468a" },
    addresses: [
      { key: "emitter", address: compoundProxy, role: "comet-proxy" },
      { key: "implementation", address: compoundImplementation, role: "decoded-implementation" },
      { key: "configurator", address: "0x45939657d1CA34A8FA39A924B71D28Fe8431e581", role: "configurator" },
      { key: "rewards", address: "0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1", role: "rewards" },
      { key: "bridge-receiver", address: "0x18281dfC4d00905DA1aaA6731414EABa843c468A", role: "bridge-receiver" },
      { key: "proxy-admin", address: "0xbdE8F31D2DdDA895264e27DD990faB3DC87b372d", role: "proxy-admin" },
      { key: "governor", address: compoundGovernor, role: "local-governor-timelock" },
      { key: "base-token", address: compoundBaseToken, role: "base-usdc" },
      { key: "sender", address: "0x9f771c534f12d711a91f1ad5bb8b4941b5252768", role: "transaction-sender" },
      { key: "recipient", address: "0x18281dfc4d00905da1aaa6731414eaba843c468a", role: "transaction-recipient" },
    ],
    checks: [
      storageCheck("implementation-before", compoundProxy, "0x265f245", "0xd84933745943df8edc45ff0f0ef7bd55324a22b6", "The configured proxy implementation slot at N-1 matches the verified pre-upgrade implementation."),
      storageCheck("implementation-at-upgrade", compoundProxy, "0x265f246", compoundImplementation, "The configured proxy implementation slot at N matches both the approved and decoded implementation.", true),
      codeCheck(compoundImplementation, "0x265f246", "18599", "0x7ad880dc9e6aeb907ddcab4b15beede0c5e85565558aa3277fac2fbbbe137ac8"),
      callAddressCheck({ id: "governor-before", to: compoundProxy, data: "0x0c340a24", blockTag: "0x265f245", value: compoundGovernor, description: "The configured Comet governor at N-1 matches the verified local governor." }),
      callAddressCheck({ id: "governor-at-upgrade", to: compoundProxy, data: "0x0c340a24", blockTag: "0x265f246", value: compoundGovernor, description: "The configured Comet governor at N matches the verified local governor." }),
      callAddressCheck({ id: "base-token-at-upgrade", to: compoundProxy, data: "0xc55dae63", blockTag: "0x265f246", value: compoundBaseToken, description: "The configured Comet baseToken() at N matches Base USDC." }),
    ],
    limitations: ["The fixed checks do not establish governance intent, proposal correctness, or complete market configuration safety."],
  }),
  buildProfile({
    id: "etherfi-base-weeth-oft",
    displayName: "ether.fi Base weETH OFT",
    protocol: "ether.fi",
    product: "Base weETH OFT",
    targetName: "weETH OFT proxy",
    targetPurpose: "Base weETH OFT implementation proxy",
    emitter: etherfiProxy,
    implementation: etherfiImplementation,
    detectorId: "etherfi-weeth-oft-upgraded",
    logIndex: "190",
    receiptId: "receipt_51d74bfc3199c526b3963fe53faaadabc7f6ff35168e56c2ee1972c7a5913487",
    block: { number: "23487559", hash: "0xeab850b0bf771ea85a8c36a41e61d731656f0dba0695f18f70542068976f0a8d", timestamp: "2024-12-09T17:14:25.000Z" },
    transaction: { hash: "0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2", sender: "0x620d7E459cfFcdC56a874536dC19147De801a4A1", recipient: "0xF9D64d54D32EE2BDceAAbFA60C4C438E224427d0" },
    addresses: [
      { key: "emitter", address: etherfiProxy, role: "weeth-oft-proxy" },
      { key: "implementation", address: etherfiImplementation, role: "decoded-implementation" },
      { key: "sync-pool", address: "0xc38e046dFDAdf15f7F56853674242888301208a5", role: "base-sync-pool" },
      { key: "proxy-admin", address: "0x2F6f3cc4a275C7951FB79199F01eD82421eDFb68", role: "proxy-admin" },
      { key: "layerzero-endpoint", address: layerZeroEndpoint, role: "layerzero-v2-endpoint" },
      { key: "sender", address: "0x620d7E459cfFcdC56a874536dC19147De801a4A1", role: "transaction-sender" },
      { key: "recipient", address: "0xF9D64d54D32EE2BDceAAbFA60C4C438E224427d0", role: "transaction-recipient" },
    ],
    checks: [
      storageCheck("implementation-before", etherfiProxy, "0x1666446", "0x20EE00F43Ef299dba82BA6FEF537756DaBE38CC7", "The configured proxy implementation slot at N-1 matches the verified pre-upgrade implementation."),
      storageCheck("implementation-at-upgrade", etherfiProxy, "0x1666447", etherfiImplementation, "The configured proxy implementation slot at N matches both the approved and decoded implementation.", true),
      codeCheck(etherfiImplementation, "0x1666447", "17594", "0x7f8bf0bedf0194598158e5b9d5510568e9d30a02b3f8e80d0acf15bf46546fb4"),
      callAddressCheck({ id: "endpoint-at-upgrade", to: etherfiProxy, data: "0x5e280f11", blockTag: "0x1666447", value: layerZeroEndpoint, description: "The configured weETH OFT endpoint() at N matches the approved LayerZero V2 endpoint." }),
      callAddressCheck({ id: "token-at-upgrade", to: etherfiProxy, data: "0xfc0c546a", blockTag: "0x1666447", value: etherfiProxy, description: "The configured weETH OFT token() at N resolves to the approved proxy." }),
      callUintCheck({ id: "shared-decimals-at-upgrade", to: etherfiProxy, data: "0x857749b0", blockTag: "0x1666447", value: "6", description: "The configured weETH OFT sharedDecimals() at N matches the verified value." }),
    ],
    limitations: ["Base-side checks do not establish the safety of remote peers, DVNs, executors, SyncPool operations, or Layer 1 backing paths."],
  }),
]);

export function getArchiveProfile(profileId) {
  return archiveProfiles.find(({ id }) => id === profileId) ?? null;
}
