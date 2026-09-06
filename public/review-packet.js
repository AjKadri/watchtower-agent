export const REVIEW_PACKET_FORMAT = "watchtower-review-packet";
export const REVIEW_PACKET_SCHEMA_VERSION = 1;

const COMMON_CHECK_IDS = new Set([
  "implementation-before",
  "implementation-at-upgrade",
  "implementation-bytecode",
]);

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  return value === undefined || value === null ? null : String(value);
}

function cloneJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function copyStringRecord(value) {
  return Object.fromEntries(
    Object.entries(objectOrEmpty(value))
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key, item]),
  );
}

function safeFailure(value) {
  const failure = objectOrEmpty(value);
  const result = {};
  for (const key of ["code", "category", "message"]) {
    if (typeof failure[key] === "string" && failure[key].length > 0) result[key] = failure[key];
  }
  return Object.keys(result).length > 0 ? result : null;
}

function sourceDescriptor(source, detail) {
  const value = source ?? detail?.source;
  if (value === "live" || value === "live-rpc" || value === "live-rpc-result") {
    return { type: "live-rpc", label: "Live RPC result" };
  }
  return { type: "verified-fixture-replay", label: "Verified fixture replay" };
}

function profileMetadata(profile) {
  const value = objectOrEmpty(profile);
  const fields = ["id", "displayName", "protocol", "product", "targetName", "targetPurpose"];
  if (fields.some((field) => typeof value[field] !== "string" || value[field].length === 0)) {
    throw new TypeError("Review packet exports require a registered protocol profile.");
  }
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function networkMetadata(network) {
  const value = objectOrEmpty(network);
  return {
    name: stringOrNull(value.name),
    chainId: Number.isInteger(value.chainId) ? value.chainId : null,
  };
}

function blockMetadata(block) {
  const value = objectOrEmpty(block);
  return {
    number: stringOrNull(value.number),
    hash: stringOrNull(value.hash),
    timestamp: stringOrNull(value.timestamp),
  };
}

function transactionMetadata(transaction) {
  const value = objectOrEmpty(transaction);
  return {
    hash: stringOrNull(value.hash),
    sender: stringOrNull(value.sender),
    recipient: stringOrNull(value.recipient),
    receiptStatus: stringOrNull(value.receiptStatus),
  };
}

function resultMetadata(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if (result.kind === "bytecode") {
    return {
      kind: "bytecode",
      present: result.present === true,
      byteLength: stringOrNull(result.byteLength),
      hash: stringOrNull(result.hash),
    };
  }
  if (result.kind === "address" || result.kind === "uint256") {
    return { kind: result.kind, value: stringOrNull(result.value) };
  }
  return { kind: stringOrNull(result.kind) };
}

function checkScope(id) {
  if (id === "implementation-before" || id === "implementation-at-upgrade") return "historical-proxy-state";
  if (id === "implementation-bytecode") return "implementation-bytecode";
  return "protocol-specific";
}

function packetCheck(check, fallbackId = null) {
  const value = objectOrEmpty(check);
  const id = stringOrNull(value.id ?? fallbackId);
  const assertion = objectOrEmpty(value.assertion);
  return {
    id,
    scope: checkScope(id),
    required: value.required !== false,
    method: stringOrNull(value.method),
    parameters: copyStringRecord(value.parameters),
    blockTag: stringOrNull(value.blockTag),
    expected: stringOrNull(assertion.expected),
    actual: stringOrNull(assertion.actual),
    status: stringOrNull(value.status) ?? "unknown",
    assertion: {
      description: stringOrNull(assertion.description),
      matches: typeof assertion.matches === "boolean" ? assertion.matches : null,
    },
    result: resultMetadata(value.result),
    failure: safeFailure(value.failure),
  };
}

function buildChecks(investigation) {
  const value = objectOrEmpty(investigation);
  const plan = objectOrEmpty(value.plan);
  const recorded = Array.isArray(value.checks) ? value.checks : [];
  const byId = new Map(recorded.map((check) => [check?.id, check]));
  const ids = uniqueStrings([
    ...(Array.isArray(plan.selectedChecks) ? plan.selectedChecks : []),
    ...(Array.isArray(plan.skippedChecks) ? plan.skippedChecks : []),
    ...recorded.map((check) => check?.id),
  ]);
  return ids.map((id) => {
    if (byId.has(id)) return packetCheck(byId.get(id));
    return {
      id,
      scope: checkScope(id),
      required: false,
      method: null,
      parameters: {},
      blockTag: null,
      expected: null,
      actual: null,
      status: "skipped",
      assertion: {
        description: "The selected plan did not authorize this check, so no RPC request was made.",
        matches: null,
      },
      result: null,
      failure: {
        code: "check-not-run",
        category: "unsupported",
        message: "This optional check was not authorized by the selected versioned plan.",
      },
    };
  });
}

function addressMetadata(profile, evidence) {
  const profileAddresses = Array.isArray(profile.addresses) ? profile.addresses : [];
  const relevant = Array.isArray(evidence.relevantAddresses) && evidence.relevantAddresses.length > 0
    ? evidence.relevantAddresses
    : profileAddresses;
  return relevant
    .filter((entry) => entry && typeof entry.address === "string" && typeof entry.role === "string")
    .map((entry) => {
      const profileEntry = profileAddresses.find((candidate) => (
        candidate?.address?.toLowerCase() === entry.address.toLowerCase()
        && candidate?.role === entry.role
      ));
      return {
        key: stringOrNull(profileEntry?.key),
        address: entry.address,
        role: entry.role,
      };
    });
}

function explorerMetadata(value) {
  const links = objectOrEmpty(value);
  return {
    transaction: stringOrNull(links.transaction),
    block: stringOrNull(links.block),
    addresses: copyStringRecord(links.addresses),
  };
}

function agentMetadata(value) {
  const agent = objectOrEmpty(value);
  const steps = Array.isArray(agent.steps) ? agent.steps.map((step) => {
    const item = objectOrEmpty(step);
    return {
      step: Number.isInteger(item.step) ? item.step : null,
      requestedCheckId: stringOrNull(item.requestedCheckId),
      rationale: stringOrNull(item.rationale),
      toolResultRef: stringOrNull(item.toolResultRef),
      outcome: stringOrNull(item.outcome),
    };
  }) : [];
  return {
    status: stringOrNull(agent.status) ?? "not-run",
    provider: stringOrNull(agent.provider),
    model: stringOrNull(agent.model),
    steps,
    narrative: stringOrNull(agent.narrative),
    uncertainty: stringOrNull(agent.uncertainty),
    failure: safeFailure(agent.failure),
  };
}

function browserVerificationMetadata(receipt, verification) {
  const performed = verification?.performed === true;
  const computedReceiptId = performed
    ? stringOrNull(verification.computedReceiptId ?? verification.expectedReceiptId)
    : null;
  const verified = performed && verification.verified === true;
  return {
    performed,
    status: performed ? (verified ? "verified" : "failed") : "not-run",
    verified,
    receiptId: stringOrNull(receipt?.receiptId),
    expectedReceiptId: computedReceiptId,
    computedReceiptId,
  };
}

function markdownValue(value) {
  if (value === undefined || value === null || value === "") return "Not recorded";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function markdownInline(value) {
  return markdownValue(value)
    .replaceAll("`", "'")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>");
}

function markdownCode(value) {
  return `\`${markdownInline(value)}\``;
}

function markdownLink(label, href) {
  return typeof href === "string" && href.length > 0 ? `[${label}](${href})` : "Not recorded";
}

function checkRow(check) {
  return `| ${markdownInline(check.id)} | ${markdownInline(check.scope)} | ${markdownInline(check.method)} | ${markdownInline(check.blockTag)} | ${markdownInline(check.expected)} | ${markdownInline(check.actual)} | ${markdownInline(check.status)} | ${markdownInline(check.failure ? JSON.stringify(check.failure) : "None")} |`;
}

function addressRows(packet) {
  return packet.addresses.map((entry) => {
    const href = packet.explorerLinks.addresses[entry.key] ?? packet.explorerLinks.addresses[entry.role];
    return `| ${markdownInline(entry.key)} | ${markdownInline(entry.role)} | ${markdownInline(entry.address)} | ${markdownLink("Open", href)} |`;
  });
}

export function buildReviewPacket(detail, options = {}) {
  const value = objectOrEmpty(detail);
  const alert = objectOrEmpty(value.alert);
  const evidence = objectOrEmpty(value.evidence);
  const investigation = objectOrEmpty(evidence.upgradeInvestigation);
  const receipt = evidence.investigationReceipt && typeof evidence.investigationReceipt === "object"
    ? evidence.investigationReceipt
    : null;
  const trigger = objectOrEmpty(receipt?.trigger);
  const event = objectOrEmpty(evidence.event);
  const log = objectOrEmpty(evidence.log ?? trigger.log);
  const checks = buildChecks(investigation);
  const links = explorerMetadata(evidence.sources ?? receipt?.explorerLinks);
  const registeredProfile = options.profile ?? value.profile;
  const profile = profileMetadata(registeredProfile);
  const source = sourceDescriptor(options.source, value);
  const limitations = uniqueStrings([
    ...(Array.isArray(alert.investigation?.limitations) ? alert.investigation.limitations : []),
    ...(Array.isArray(receipt?.limitations) ? receipt.limitations : []),
  ]);
  const implementationCheck = checks.find(({ id }) => id === "implementation-bytecode") ?? null;
  const observedFacts = uniqueStrings([
    ...(Array.isArray(alert.investigation?.observedFacts) ? alert.investigation.observedFacts : []),
    ...(Array.isArray(evidence.observedFacts) ? evidence.observedFacts : []),
  ]);
  const packet = {
    format: REVIEW_PACKET_FORMAT,
    schemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
    source,
    profile,
    network: networkMetadata(evidence.network ?? trigger.network),
    incident: {
      id: stringOrNull(alert.id),
      classification: stringOrNull(alert.classificationLabel),
      title: stringOrNull(alert.title),
      summary: stringOrNull(alert.summary),
      observedAt: stringOrNull(alert.observedAt),
      evidenceStatus: stringOrNull(alert.evidenceStatus ?? evidence.status),
    },
    upgrade: {
      transaction: transactionMetadata(evidence.transaction ?? trigger.transaction),
      block: blockMetadata(evidence.block ?? trigger.block),
      event: {
        signature: stringOrNull(event.signature ?? trigger.eventSignature),
        emitter: stringOrNull(log.emitter),
        logIndex: stringOrNull(log.index),
        decodedImplementation: stringOrNull(event.decodedArguments?.implementation ?? trigger.decodedArguments?.implementation),
        topic0: stringOrNull(log.topic0),
        rawTopics: Array.isArray(log.rawTopics) ? [...log.rawTopics] : [],
      },
    },
    addresses: addressMetadata(registeredProfile, evidence),
    historicalProxyState: {
      before: checks.find(({ id }) => id === "implementation-before") ?? null,
      atUpgrade: checks.find(({ id }) => id === "implementation-at-upgrade") ?? null,
    },
    implementationBytecode: implementationCheck,
    checks,
    protocolChecks: checks.filter(({ scope }) => scope === "protocol-specific"),
    severity: {
      level: stringOrNull(alert.severity ?? evidence.severity?.result ?? trigger.detector?.severity),
      ruleId: stringOrNull(alert.severityRuleId ?? evidence.severity?.ruleId ?? trigger.detector?.severityRuleId),
      inputs: copyStringRecord(evidence.severity?.inputs),
      deterministic: true,
    },
    disposition: stringOrNull(investigation.disposition ?? receipt?.finalDisposition),
    observedFacts,
    interpretation: cloneJson(alert.investigation?.interpretation ?? null),
    limitations,
    receipt: {
      identifier: stringOrNull(receipt?.receiptId),
      schemaVersion: receipt?.schemaVersion ?? null,
      canonical: cloneJson(receipt),
    },
    browserVerification: browserVerificationMetadata(receipt, options.browserVerification),
    explorerLinks: links,
    agentInvestigation: agentMetadata(evidence.agentInvestigation),
  };
  return packet;
}

export function serializeReviewPacketJson(packet) {
  return `${JSON.stringify(packet, null, 2)}\n`;
}

export function formatReviewPacketMarkdown(packet) {
  const receipt = packet.receipt.canonical;
  const canonicalReceipt = receipt ? JSON.stringify(receipt, null, 2) : "null";
  const agent = packet.agentInvestigation;
  const lines = [
    "# Watchtower review packet",
    "",
    `- Packet format: ${markdownCode(packet.format)}`,
    `- Packet schema version: ${markdownCode(packet.schemaVersion)}`,
    `- Source: ${markdownCode(packet.source.label)} (${markdownCode(packet.source.type)})`,
    `- Network: ${markdownCode(packet.network.name)} · chain ID ${markdownCode(packet.network.chainId)}`,
    "",
    "## Protocol profile",
    "",
    `- Profile ID: ${markdownCode(packet.profile.id)}`,
    `- Display name: ${markdownCode(packet.profile.displayName)}`,
    `- Protocol: ${markdownCode(packet.profile.protocol)}`,
    `- Product: ${markdownCode(packet.profile.product)}`,
    `- Target: ${markdownCode(packet.profile.targetName)}`,
    `- Purpose: ${markdownCode(packet.profile.targetPurpose)}`,
    "",
    "## Incident",
    "",
    `- ID: ${markdownCode(packet.incident.id)}`,
    `- Classification: ${markdownCode(packet.incident.classification)}`,
    `- Title: ${markdownValue(packet.incident.title)}`,
    `- Summary: ${markdownValue(packet.incident.summary)}`,
    `- Observed at: ${markdownCode(packet.incident.observedAt)}`,
    `- Evidence status: ${markdownCode(packet.incident.evidenceStatus)}`,
    "",
    "## Upgrade evidence",
    "",
    `- Transaction: ${markdownCode(packet.upgrade.transaction.hash)} · ${markdownLink("Open", packet.explorerLinks.transaction)}`,
    `- Sender: ${markdownCode(packet.upgrade.transaction.sender)}`,
    `- Recipient: ${markdownCode(packet.upgrade.transaction.recipient)}`,
    `- Receipt status: ${markdownCode(packet.upgrade.transaction.receiptStatus)}`,
    `- Block: ${markdownCode(packet.upgrade.block.number)} · ${markdownLink("Open", packet.explorerLinks.block)}`,
    `- Block hash: ${markdownCode(packet.upgrade.block.hash)}`,
    `- Timestamp: ${markdownCode(packet.upgrade.block.timestamp)}`,
    `- Event signature: ${markdownCode(packet.upgrade.event.signature)}`,
    `- Emitter: ${markdownCode(packet.upgrade.event.emitter)}`,
    `- Log index: ${markdownCode(packet.upgrade.event.logIndex)}`,
    `- Decoded implementation: ${markdownCode(packet.upgrade.event.decodedImplementation)}`,
    `- Topic zero: ${markdownCode(packet.upgrade.event.topic0)}`,
    "",
    "## Relevant addresses",
    "",
    "| Key | Role | Address | Explorer |",
    "| --- | --- | --- | --- |",
    ...addressRows(packet),
    "",
    "## Historical proxy state",
    "",
    `- Before upgrade: ${markdownCode(packet.historicalProxyState.before?.actual)} · ${markdownCode(packet.historicalProxyState.before?.status)}`,
    `- At upgrade: ${markdownCode(packet.historicalProxyState.atUpgrade?.actual)} · ${markdownCode(packet.historicalProxyState.atUpgrade?.status)}`,
    "",
    "## Implementation bytecode evidence",
    "",
    packet.implementationBytecode
      ? `- ${markdownInline(JSON.stringify(packet.implementationBytecode))}`
      : "- Not recorded",
    "",
    "## Checks",
    "",
    "| Check | Scope | Method | Block tag | Expected | Actual | Status | Failure |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...packet.checks.map(checkRow),
    "",
    "## Severity and disposition",
    "",
    `- Deterministic severity: ${markdownCode(packet.severity.level)}`,
    `- Severity rule: ${markdownCode(packet.severity.ruleId)}`,
    `- Severity inputs: ${markdownCode(packet.severity.inputs)}`,
    `- Deterministic disposition: ${markdownCode(packet.disposition)}`,
    "",
    "## Observed facts",
    "",
    ...(packet.observedFacts.length > 0 ? packet.observedFacts.map((fact) => `- ${fact}`) : ["- None recorded"]),
    "",
    "## Interpretation",
    "",
    packet.interpretation ? `- ${markdownValue(packet.interpretation.text)}` : "- None recorded",
    "",
    "## Limitations",
    "",
    ...(packet.limitations.length > 0 ? packet.limitations.map((limitation) => `- ${limitation}`) : ["- None recorded"]),
    "",
    "## Receipt",
    "",
    `- Canonical receipt identifier: ${markdownCode(packet.receipt.identifier)}`,
    `- Receipt schema version: ${markdownCode(packet.receipt.schemaVersion)}`,
    `- Browser verification: ${markdownCode(packet.browserVerification.status)} · performed: ${markdownCode(packet.browserVerification.performed)}`,
    `- Browser-computed receipt ID: ${markdownCode(packet.browserVerification.computedReceiptId)}`,
    "",
    "### Canonical receipt",
    "",
    "~~~~json",
    canonicalReceipt,
    "~~~~",
    "",
    "## Explorer links",
    "",
    `- Transaction: ${markdownLink("Open", packet.explorerLinks.transaction)}`,
    `- Block: ${markdownLink("Open", packet.explorerLinks.block)}`,
    ...Object.entries(packet.explorerLinks.addresses).map(([key, href]) => `- ${markdownInline(key)}: ${markdownLink("Open", href)}`),
    "",
    "## Agent investigation (outside the canonical receipt)",
    "",
    `- Status: ${markdownCode(agent.status)}`,
    `- Provider: ${markdownCode(agent.provider)}`,
    `- Model: ${markdownCode(agent.model)}`,
    "",
    "### Agent steps",
    "",
    "| Step | Requested check | Rationale | Result | Outcome |",
    "| --- | --- | --- | --- | --- |",
    ...(agent.steps.length > 0
      ? agent.steps.map((step) => `| ${markdownInline(step.step)} | ${markdownInline(step.requestedCheckId)} | ${markdownInline(step.rationale)} | ${markdownInline(step.toolResultRef)} | ${markdownInline(step.outcome)} |`)
      : ["| None | None | No agent steps recorded | None | not-run |"]),
    "",
    `- Narrative: ${markdownValue(agent.narrative)}`,
    `- Uncertainty: ${markdownValue(agent.uncertainty)}`,
    `- Failure: ${markdownCode(agent.failure)}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function reviewPacketFilename(packet, extension) {
  const suffix = extension === "md" ? "md" : "json";
  const identifier = packet.receipt.identifier ?? "without-receipt";
  return `watchtower-${identifier}-review-packet.${suffix}`;
}
