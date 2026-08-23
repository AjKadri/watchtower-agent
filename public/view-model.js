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
