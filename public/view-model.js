export async function fetchHealth(request) {
  return request("/api/health");
}

export function formatUtcTimestamp(value) {
  if (!value) return "Time unavailable";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Time unavailable";
  return `${timestamp.toISOString()} (UTC)`;
}

export function reconcileAlertSelection(alerts, selectedAlertId, selectFirst = false) {
  if (selectedAlertId && alerts.some(({ id }) => id === selectedAlertId)) return selectedAlertId;
  return selectFirst ? alerts[0]?.id ?? null : null;
}

export function canRenderAlertDetail(alerts, selectedAlertId, responseAlertId) {
  return selectedAlertId === responseAlertId && alerts.some(({ id }) => id === responseAlertId);
}

export function buildProfileOptions(profiles, activeProfileId) {
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.displayName,
    protocol: profile.protocol,
    product: profile.product,
    isActive: profile.id === activeProfileId,
  }));
}

export function buildArchiveEntries(profiles) {
  return [...profiles]
    .filter(({ source }) => source === "verified-fixture")
    .sort((left, right) => right.block.timestamp.localeCompare(left.block.timestamp))
    .map((profile) => ({
      profileId: profile.id,
      protocol: profile.displayName,
      event: profile.event,
      block: profile.block.number,
      timestamp: profile.block.timestamp,
      disposition: profile.disposition,
      checkCount: profile.receipt.checks.length,
      receiptId: profile.receipt.receiptId,
    }));
}

export function investigationSourceLabel(source) {
  return source === "live" ? "Live RPC result" : "Verified fixture";
}

export function isMobileLayout(viewportWidth) {
  return Number.isFinite(viewportWidth) && viewportWidth <= 720;
}

export function buildFixtureDetail(profile) {
  const { receipt } = profile;
  const { trigger } = receipt;
  const evidence = {
    id: `fixture-evidence-${profile.id}`,
    status: "complete",
    network: trigger.network,
    block: trigger.block,
    transaction: trigger.transaction,
    log: trigger.log,
    event: { signature: trigger.eventSignature, decodedArguments: trigger.decodedArguments },
    relevantAddresses: profile.addresses.map(({ address, role }) => ({ address, role })),
    detector: {
      id: trigger.detector.id,
      inputs: { configuredEmitter: trigger.log.emitter, configuredTopic0: trigger.log.topic0 },
    },
    severity: {
      ruleId: trigger.detector.severityRuleId,
      inputs: { implementation: trigger.decodedArguments.implementation, approved: "true", isZeroAddress: "false" },
      result: trigger.detector.severity,
    },
    upgradeInvestigation: {
      plan: receipt.plan,
      disposition: receipt.finalDisposition,
      evidenceStatus: "complete",
      checks: receipt.checks,
    },
    investigationReceipt: receipt,
    observedFacts: [
      `The configured ${profile.displayName} proxy emitted Upgraded(address) at log index ${trigger.log.index}.`,
      `The decoded implementation address is ${trigger.decodedArguments.implementation}.`,
      `The transaction receipt status is ${trigger.transaction.receiptStatus}.`,
    ],
    sources: receipt.explorerLinks,
    errors: [],
  };
  const alert = {
    id: `fixture-alert-${profile.id}`,
    targetId: profile.id,
    classificationLabel: "Contract upgrade",
    severity: trigger.detector.severity,
    evidenceStatus: "complete",
    title: `${profile.displayName} implementation investigation`,
    summary: `${profile.targetName} emitted Upgraded(address). Six fixed historical checks corroborated the configured implementation and protocol identity values.`,
    observedAt: trigger.block.timestamp,
    investigation: {
      observedFacts: evidence.observedFacts,
      interpretation: {
        severityRuleId: trigger.detector.severityRuleId,
        text: "The decoded implementation matches the profile's approved implementation. The deterministic rule classifies that exact comparison as informational.",
      },
      limitations: receipt.limitations,
    },
    sources: receipt.explorerLinks,
  };
  return { alert, evidence, scanFailures: [], source: "verified-fixture", profile };
}

function recordLines(record) {
  const entries = Object.entries(record ?? {});
  return entries.length > 0 ? entries.map(([key, value]) => `${key}: ${value}`).join("\n") : "None";
}

export function buildEvidenceRows(evidence, classificationLabel) {
  const implementation = evidence.event.decodedArguments.implementation ?? "Unavailable";
  return [
    { label: "Classification", value: classificationLabel },
    { label: "Severity rule", value: evidence.severity.ruleId },
    { label: "Evidence status", value: evidence.status },
    { label: "Transaction", value: evidence.transaction.hash, link: evidence.sources.transaction },
    { label: "Sender", value: evidence.transaction.sender ?? "Unavailable", link: evidence.sources.addresses.sender },
    { label: "Recipient", value: evidence.transaction.recipient ?? "Unavailable", link: evidence.sources.addresses.recipient },
    { label: "Receipt", value: evidence.transaction.receiptStatus ?? "Unavailable" },
    { label: "Block number", value: evidence.block.number, link: evidence.sources.block },
    { label: "Block hash", value: evidence.block.hash, link: evidence.sources.block },
    { label: "Block timestamp", value: evidence.block.timestamp ? formatUtcTimestamp(evidence.block.timestamp) : "Unavailable" },
    { label: "Log index", value: evidence.log.index },
    { label: "Emitter", value: evidence.log.emitter, link: evidence.sources.addresses.emitter },
    { label: "Topic zero", value: evidence.log.topic0 },
    { label: "Raw topics", value: evidence.log.rawTopics.join("\n") },
    { label: "Implementation", value: implementation, link: evidence.sources.addresses.implementation },
    { label: "Event signature", value: evidence.event.signature },
    { label: "Detector inputs", value: recordLines(evidence.detector.inputs) },
    { label: "Severity inputs", value: recordLines(evidence.severity.inputs) },
    {
      label: "Configured address roles",
      value: evidence.relevantAddresses.map(({ address, role }) => `${role}: ${address}`).join("\n"),
    },
    { label: "Chain", value: `${evidence.network.name} · ${evidence.network.chainId}` },
  ];
}

const checkLabels = {
  "implementation-before": "Implementation slot at N-1",
  "implementation-at-upgrade": "Implementation slot at N",
  "implementation-bytecode": "Implementation bytecode at N",
  "configured-pool": "PoolAddressesProvider getPool() at N",
  "pool-revision-before": "Optional POOL_REVISION() at N-1",
  "pool-revision-at-upgrade": "Optional POOL_REVISION() at N",
  "governor-before": "Comet governor() at N-1",
  "governor-at-upgrade": "Comet governor() at N",
  "base-token-at-upgrade": "Comet baseToken() at N",
  "endpoint-at-upgrade": "OFT endpoint() at N",
  "token-at-upgrade": "OFT token() at N",
  "shared-decimals-at-upgrade": "OFT sharedDecimals() at N",
};

function checkSummary(check) {
  if (check.status === "passed" || check.status === "mismatch") {
    return `${check.method} ${check.blockTag}: expected ${check.assertion.expected}, observed ${check.assertion.actual}.`;
  }
  return `${check.method} ${check.blockTag}: ${check.failure?.message ?? "No verified result is available."}`;
}

function checkDetail(check) {
  return {
    id: check.id,
    label: checkLabels[check.id] ?? check.id,
    status: check.status,
    summary: checkSummary(check),
    elapsedMs: Number.isFinite(check.elapsedMs) ? check.elapsedMs : null,
  };
}

function skippedDetail(id) {
  return {
    id,
    label: checkLabels[id] ?? id,
    status: "skipped",
    summary: "The selected versioned plan did not authorize this optional check.",
    elapsedMs: null,
  };
}

function stageStatus(details) {
  const selected = details.filter(({ status }) => status !== "skipped");
  if (selected.length === 0) return "incomplete";
  if (selected.some(({ status }) => status === "failed" || status === "mismatch")) return "failed";
  if (selected.some(({ status }) => status === "unsupported")) return "incomplete";
  return "complete";
}

function elapsedFor(details) {
  const values = details.map(({ elapsedMs }) => elapsedMs).filter(Number.isFinite);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function checksFor(ids, checks, skippedChecks) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  return ids.flatMap((id) => {
    const check = byId.get(id);
    if (check) return [checkDetail(check)];
    return skippedChecks.includes(id) ? [skippedDetail(id)] : [];
  });
}

export function buildInvestigationTrace(detail) {
  const { alert, evidence } = detail;
  const investigation = evidence.upgradeInvestigation;
  const plan = investigation?.plan;
  const checks = investigation?.checks ?? [];
  const skippedChecks = plan?.skippedChecks ?? [];
  const historicalIds = ["implementation-before", "implementation-at-upgrade"];
  const implementationIds = ["implementation-bytecode"];
  const commonIds = new Set([...historicalIds, ...implementationIds]);
  const plannedIds = [...(plan?.selectedChecks ?? []), ...skippedChecks];
  const protocolIds = [...new Set(plannedIds.filter((id) => !commonIds.has(id)))];
  const historical = checksFor(historicalIds, checks, skippedChecks);
  const implementation = checksFor(implementationIds, checks, skippedChecks);
  const protocol = checksFor(protocolIds, checks, skippedChecks);
  const identityLinks = [
    ["Verify provider", evidence.sources.addresses.provider],
    ["Verify governor", evidence.sources.addresses.governor],
    ["Verify Base USDC", evidence.sources.addresses["base-token"]],
    ["Verify LayerZero endpoint", evidence.sources.addresses["layerzero-endpoint"]],
  ].filter(([, href]) => Boolean(href)).map(([label, href]) => ({ label, href, external: true }));
  const receipt = evidence.investigationReceipt;
  const eventComplete = Boolean(
    evidence.block.timestamp
    && evidence.transaction.sender
    && evidence.transaction.receiptStatus
    && evidence.log.rawTopics?.length,
  );
  const receiptStatus = !receipt
    ? "incomplete"
    : receipt.finalDisposition === "contradicted"
      ? "failed"
      : receipt.finalDisposition === "incomplete"
        ? "incomplete"
        : "complete";

  return [
    {
      id: "event-observed",
      index: 1,
      title: "Event observed",
      status: eventComplete ? "complete" : "incomplete",
      elapsedMs: null,
      summary: eventComplete
        ? `${evidence.event.signature} was verified at log ${evidence.log.index} in transaction ${evidence.transaction.hash}.`
        : "The candidate event is present, but complete trigger evidence is unavailable.",
      details: [],
      links: [
        { label: "Verify transaction", href: evidence.sources.transaction, external: true },
        { label: "Open evidence", href: "#evidence-record", external: false },
      ],
    },
    {
      id: "plan-selected",
      index: 2,
      title: "Plan selected",
      status: plan ? "complete" : "incomplete",
      elapsedMs: null,
      summary: plan
        ? `${plan.id} version ${plan.version}. ${plan.selectionReason.text}`
        : "No validated investigation plan is available.",
      details: plan ? [
        { id: "selected", label: "Selected checks", status: "passed", summary: plan.selectedChecks.join(", ") || "None", elapsedMs: null },
        { id: "skipped", label: "Skipped checks", status: plan.skippedChecks.length > 0 ? "skipped" : "passed", summary: plan.skippedChecks.join(", ") || "None", elapsedMs: null },
        { id: "budget", label: "Read budget", status: "passed", summary: `${plan.capabilityBudget.maximumReads} maximum RPC reads`, elapsedMs: null },
      ] : [],
      links: [],
    },
    {
      id: "historical-state-checked",
      index: 3,
      title: "Historical state checked",
      status: stageStatus(historical),
      elapsedMs: elapsedFor(historical),
      summary: "EIP-1967 implementation storage was checked at the two approved historical block tags.",
      details: historical,
      links: [],
    },
    {
      id: "implementation-checked",
      index: 4,
      title: "Implementation checked",
      status: stageStatus(implementation),
      elapsedMs: elapsedFor(implementation),
      summary: "Decoded implementation bytecode was checked only at the approved upgrade block.",
      details: implementation,
      links: evidence.sources.addresses.implementation
        ? [{ label: "Verify implementation", href: evidence.sources.addresses.implementation, external: true }]
        : [],
    },
    {
      id: "protocol-identity-checked",
      index: 5,
      title: "Protocol identity checked",
      status: stageStatus(protocol),
      elapsedMs: elapsedFor(protocol),
      summary: "The profile's fixed protocol identity checks are shown below.",
      details: protocol,
      links: identityLinks,
    },
    {
      id: "receipt-issued",
      index: 6,
      title: "Receipt issued",
      status: receiptStatus,
      elapsedMs: null,
      summary: receipt
        ? `${receipt.receiptId} records the ${receipt.finalDisposition} final disposition.`
        : "No replayable receipt was issued because complete trigger evidence is unavailable.",
      details: receipt?.errors.map((error) => ({
        id: error.code,
        label: error.category,
        status: "failed",
        summary: error.message,
        elapsedMs: null,
      })) ?? [],
      links: receipt ? [{
        label: "Download receipt JSON",
        href: `/api/receipts/${encodeURIComponent(receipt.receiptId)}`,
        external: false,
        download: `watchtower-${receipt.receiptId}.json`,
      }] : [],
    },
  ];
}
