import { archiveProfiles } from "./archive-data.js";
import {
  createReceiptId,
  normalizeEvmAddresses,
  stableSerialize,
} from "./receipt-verifier.js";

export const PORTABLE_INTEGRITY_FORMAT = "watchtower-portable-integrity";
export const PORTABLE_INTEGRITY_VERSION = 1;

const ARTIFACT_ID_PATTERN = /^artifact_[0-9a-f]{64}$/;
const RECEIPT_ID_PATTERN = /^receipt_[0-9a-f]{64}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BLOCK_TAG_PATTERN = /^0x[0-9a-f]+$/;
const RPC_CATEGORIES = new Set(["dns", "timeout", "rate-limit", "unavailable"]);
const FAILURE_CATEGORIES = new Set(["dns", "timeout", "rate-limit", "malformed-response", "unsupported", "unavailable"]);
const CHECK_IDS = new Set([
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
const CHECK_METHODS = new Set(["eth_getStorageAt", "eth_getCode", "eth_call"]);
const CHECK_STATUSES = new Set(["passed", "mismatch", "failed", "unsupported"]);
const CHECK_RESULT_KINDS = new Set(["address", "bytecode", "uint256"]);
const SEVERITIES = new Set(["high", "suspicious", "informational"]);
const SEVERITY_RULES = new Set(["target-is-zero-address", "target-is-not-approved", "target-is-approved"]);
const PROFILE_IDS = new Set(archiveProfiles.map(({ id }) => id));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(left, right) {
  try {
    return stableSerialize(normalizeEvmAddresses(left)) === stableSerialize(normalizeEvmAddresses(right));
  } catch {
    return Object.is(left, right);
  }
}

function result(status, outcome = null, refusalCode = null, details = {}) {
  const defaultMessage = outcome === "FIXTURE_ONLY"
    ? "Portable proof verified as a committed fixture replay."
    : outcome === "CORROBORATED"
      ? "Portable proof verified against the closed profile registry. Live provenance is not authenticated offline."
      : outcome
        ? `Portable proof result: ${outcome}.`
        : refusalCode
          ? `Portable proof refused: ${refusalCode}.`
          : "Portable proof verification unavailable.";
  return {
    status,
    verified: status === "verified",
    outcome,
    refusalCode,
    artifactId: details.artifactId ?? null,
    computedArtifactId: details.computedArtifactId ?? null,
    receiptId: details.receiptId ?? null,
    computedReceiptId: details.computedReceiptId ?? null,
    provenanceAuthenticated: false,
    message: details.message ?? defaultMessage,
    matchedPaths: details.matchedPaths ?? [],
    failedPaths: details.failedPaths ?? [],
    ...details,
  };
}

function malformed(message, details = {}) {
  return result("refused", null, "malformed-artifact", { message, ...details });
}

function issue(path, code = "malformed-artifact") {
  return { path, code };
}

function strictObject(value, keys, path) {
  if (!isRecord(value)) return issue(path);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return issue(`${path}.${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) return issue(`${path}.${key}`);
  }
  return null;
}

function strictObjectWithOptional(value, keys, optionalKeys, path) {
  if (!isRecord(value)) return issue(path);
  const allowed = new Set([...keys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return issue(`${path}.${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) return issue(`${path}.${key}`);
  }
  return null;
}

function stringValue(value, path, pattern = null, nonEmpty = true) {
  if (typeof value !== "string" || (nonEmpty && value.length === 0) || (pattern && !pattern.test(value))) return issue(path);
  return null;
}

function booleanValue(value, path) {
  return typeof value === "boolean" ? null : issue(path);
}

function integerValue(value, path, minimum = null) {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && (minimum === null || value >= minimum)
    ? null
    : issue(path);
}

function nullable(value, validator, path) {
  return value === null ? null : validator(value, path);
}

function arrayValue(value, path, itemValidator, options = {}) {
  if (!Array.isArray(value)) return issue(path);
  if (options.min !== undefined && value.length < options.min) return issue(path);
  if (options.max !== undefined && value.length > options.max) return issue(path);
  for (let index = 0; index < value.length; index += 1) {
    const failure = itemValidator(value[index], `${path}[${index}]`);
    if (failure) return failure;
  }
  return null;
}

function recordOfStrings(value, path) {
  if (!isRecord(value)) return issue(path);
  for (const [key, item] of Object.entries(value)) {
    if (key.length === 0 || typeof item !== "string" || item.length === 0) return issue(`${path}.${key}`);
  }
  return null;
}

function isoDate(value, path) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : issue(path);
}

function urlValue(value, path) {
  if (typeof value !== "string" || value.length === 0) return issue(path);
  try {
    new URL(value);
    return null;
  } catch {
    return issue(path);
  }
}

function addressValue(value, path) {
  return stringValue(value, path, ADDRESS_PATTERN);
}

function hashValue(value, path) {
  return stringValue(value, path, HASH_PATTERN);
}

function decimalValue(value, path) {
  return stringValue(value, path, DECIMAL_PATTERN);
}

function sourceLinksShape(value, path) {
  let failure = strictObject(value, ["transaction", "block", "addresses"], path);
  if (failure) return failure;
  failure = urlValue(value.transaction, `${path}.transaction`) || urlValue(value.block, `${path}.block`);
  if (failure) return failure;
  if (!isRecord(value.addresses)) return issue(`${path}.addresses`);
  for (const [key, link] of Object.entries(value.addresses)) {
    failure = urlValue(link, `${path}.addresses.${key}`);
    if (failure) return failure;
  }
  return null;
}

function planShape(plan, path) {
  let failure = strictObject(plan, ["id", "version", "selectionReason", "selectedChecks", "skippedChecks", "capabilityBudget"], path);
  if (failure) return failure;
  if (!["corroborate-approved-upgrade", "escalate-unapproved-upgrade", "stop-incomplete"].includes(plan.id)) return issue(`${path}.id`);
  if (plan.version !== "1.0.0") return issue(`${path}.version`);
  failure = strictObject(plan.selectionReason, ["code", "text"], `${path}.selectionReason`);
  if (failure) return failure;
  if (!["approved-target", "unapproved-target", "trigger-evidence-incomplete"].includes(plan.selectionReason.code)) return issue(`${path}.selectionReason.code`);
  failure = stringValue(plan.selectionReason.text, `${path}.selectionReason.text`);
  if (failure) return failure;
  for (const key of ["selectedChecks", "skippedChecks"]) {
    failure = arrayValue(plan[key], `${path}.${key}`, (item, itemPath) => CHECK_IDS.has(item) ? null : issue(itemPath), { max: 6 });
    if (failure) return failure;
  }
  failure = strictObject(plan.capabilityBudget, ["maximumReads", "capabilities"], `${path}.capabilityBudget`);
  if (failure) return failure;
  failure = integerValue(plan.capabilityBudget.maximumReads, `${path}.capabilityBudget.maximumReads`, 0);
  if (failure || plan.capabilityBudget.maximumReads > 6) return failure || issue(`${path}.capabilityBudget.maximumReads`);
  return arrayValue(plan.capabilityBudget.capabilities, `${path}.capabilityBudget.capabilities`, (capability, capabilityPath) => {
    let capabilityFailure = strictObject(capability, ["name", "maximumUses"], capabilityPath);
    if (capabilityFailure) return capabilityFailure;
    if (!["historical-storage-read", "historical-code-read", "historical-contract-call"].includes(capability.name)) return issue(`${capabilityPath}.name`);
    const usesFailure = integerValue(capability.maximumUses, `${capabilityPath}.maximumUses`, 1);
    return usesFailure || capability.maximumUses > 6 ? usesFailure || issue(`${capabilityPath}.maximumUses`) : null;
  }, { max: 3 });
}

function failureShape(value, path) {
  if (!isRecord(value)) return issue(path);
  let failure = strictObject(value, ["code", "category", "message"], path);
  if (failure) return failure;
  failure = stringValue(value.code, `${path}.code`);
  if (failure) return failure;
  if (!FAILURE_CATEGORIES.has(value.category)) return issue(`${path}.category`);
  return stringValue(value.message, `${path}.message`);
}

function checkShape(check, path) {
  let failure = strictObjectWithOptional(
    check,
    ["id", "required", "method", "parameters", "blockTag", "result", "assertion", "status", "failure"],
    ["elapsedMs"],
    path,
  );
  if (failure) return failure;
  if (!CHECK_IDS.has(check.id)) return issue(`${path}.id`);
  failure = booleanValue(check.required, `${path}.required`);
  if (failure) return failure;
  if (!CHECK_METHODS.has(check.method)) return issue(`${path}.method`);
  if (!isRecord(check.parameters)) return issue(`${path}.parameters`);
  for (const [key, value] of Object.entries(check.parameters)) {
    if (key.length === 0 || typeof value !== "string" || value.length === 0) return issue(`${path}.parameters.${key}`);
  }
  failure = stringValue(check.blockTag, `${path}.blockTag`, BLOCK_TAG_PATTERN);
  if (failure) return failure;
  if (check.result !== null) {
    const resultKeys = check.result?.kind === "bytecode" ? ["kind", "present", "byteLength", "hash"] : ["kind", "value"];
    failure = strictObject(check.result, resultKeys, `${path}.result`);
    if (failure) return failure;
    if (!CHECK_RESULT_KINDS.has(check.result.kind)) return issue(`${path}.result.kind`);
    if (check.result.kind === "address") failure = addressValue(check.result.value, `${path}.result.value`);
    else if (check.result.kind === "uint256") failure = decimalValue(check.result.value, `${path}.result.value`);
    else {
      failure = booleanValue(check.result.present, `${path}.result.present`);
      if (!failure) failure = decimalValue(check.result.byteLength, `${path}.result.byteLength`);
      if (!failure) failure = nullable(check.result.hash, hashValue, `${path}.result.hash`);
    }
    if (failure) return failure;
  }
  failure = strictObject(check.assertion, ["description", "expected", "actual", "matches"], `${path}.assertion`);
  if (failure) return failure;
  for (const key of ["description", "expected"]) {
    failure = stringValue(check.assertion[key], `${path}.assertion.${key}`);
    if (failure) return failure;
  }
  failure = nullable(check.assertion.actual, stringValue, `${path}.assertion.actual`);
  if (failure) return failure;
  if (check.assertion.matches !== null && typeof check.assertion.matches !== "boolean") return issue(`${path}.assertion.matches`);
  if (!CHECK_STATUSES.has(check.status)) return issue(`${path}.status`);
  if (check.failure !== null) {
    failure = failureShape(check.failure, `${path}.failure`);
    if (failure) return failure;
  }
  if (Object.hasOwn(check, "elapsedMs")) failure = integerValue(check.elapsedMs, `${path}.elapsedMs`, 0);
  return failure;
}

function triggerShape(trigger, path) {
  let failure = strictObject(trigger, ["network", "targetId", "incidentClass", "eventType", "eventSignature", "decodedArguments", "block", "transaction", "log", "detector"], path);
  if (failure) return failure;
  failure = strictObject(trigger.network, ["name", "chainId"], `${path}.network`);
  if (failure) return failure;
  if (trigger.network.name !== "base-mainnet" || trigger.network.chainId !== 8453) return issue(`${path}.network`);
  if (!PROFILE_IDS.has(trigger.targetId)) return issue(`${path}.targetId`);
  if (trigger.incidentClass !== "contract_upgrade") return issue(`${path}.incidentClass`);
  if (trigger.eventType !== "proxy_upgraded") return issue(`${path}.eventType`);
  if (trigger.eventSignature !== "Upgraded(address)") return issue(`${path}.eventSignature`);
  failure = strictObject(trigger.decodedArguments, ["implementation"], `${path}.decodedArguments`);
  if (failure) return failure;
  failure = addressValue(trigger.decodedArguments.implementation, `${path}.decodedArguments.implementation`);
  if (failure) return failure;
  failure = strictObject(trigger.block, ["number", "hash", "timestamp"], `${path}.block`);
  if (failure) return failure;
  failure = decimalValue(trigger.block.number, `${path}.block.number`) || hashValue(trigger.block.hash, `${path}.block.hash`) || isoDate(trigger.block.timestamp, `${path}.block.timestamp`);
  if (failure) return failure;
  failure = strictObject(trigger.transaction, ["hash", "sender", "recipient", "receiptStatus"], `${path}.transaction`);
  if (failure) return failure;
  failure = hashValue(trigger.transaction.hash, `${path}.transaction.hash`);
  if (!failure) failure = nullable(trigger.transaction.sender, addressValue, `${path}.transaction.sender`);
  if (!failure) failure = nullable(trigger.transaction.recipient, addressValue, `${path}.transaction.recipient`);
  if (!failure && !["success", "reverted"].includes(trigger.transaction.receiptStatus)) failure = issue(`${path}.transaction.receiptStatus`);
  if (failure) return failure;
  failure = strictObject(trigger.log, ["index", "emitter", "topic0", "rawTopics"], `${path}.log`);
  if (failure) return failure;
  failure = decimalValue(trigger.log.index, `${path}.log.index`) || addressValue(trigger.log.emitter, `${path}.log.emitter`) || hashValue(trigger.log.topic0, `${path}.log.topic0`);
  if (!failure) failure = arrayValue(trigger.log.rawTopics, `${path}.log.rawTopics`, hashValue, { min: 1 });
  if (failure) return failure;
  failure = strictObject(trigger.detector, ["id", "severityRuleId", "severity"], `${path}.detector`);
  if (failure) return failure;
  failure = stringValue(trigger.detector.id, `${path}.detector.id`);
  if (!failure && !SEVERITY_RULES.has(trigger.detector.severityRuleId)) failure = issue(`${path}.detector.severityRuleId`);
  if (!failure && !SEVERITIES.has(trigger.detector.severity)) failure = issue(`${path}.detector.severity`);
  return failure;
}

function receiptShape(receipt) {
  if (!isRecord(receipt)) return { ok: false, code: "malformed-receipt", path: "receipt" };
  const topFailure = strictObject(receipt, ["receiptId", "schemaVersion", "trigger", "plan", "checks", "errors", "limitations", "finalDisposition", "explorerLinks"], "receipt");
  if (topFailure) return { ok: false, code: "malformed-receipt", path: topFailure.path };
  if (receipt.schemaVersion !== 1) return { ok: false, code: "unsupported-receipt-version", path: "receipt.schemaVersion" };
  if (typeof receipt.receiptId !== "string" || !RECEIPT_ID_PATTERN.test(receipt.receiptId)) return { ok: false, code: "malformed-receipt", path: "receipt.receiptId" };
  let failure = triggerShape(receipt.trigger, "receipt.trigger");
  if (failure) return { ok: false, code: "malformed-receipt", path: failure.path };
  failure = planShape(receipt.plan, "receipt.plan");
  if (failure) return { ok: false, code: "malformed-receipt", path: failure.path };
  failure = arrayValue(receipt.checks, "receipt.checks", checkShape, { max: 6 });
  if (failure) return { ok: false, code: "malformed-receipt", path: failure.path };
  failure = arrayValue(receipt.errors, "receipt.errors", failureShape);
  if (failure) return { ok: false, code: "malformed-receipt", path: failure.path };
  failure = arrayValue(receipt.limitations, "receipt.limitations", stringValue, { min: 1 });
  if (failure) return { ok: false, code: "malformed-receipt", path: failure.path };
  if (!["corroborated", "contradicted", "incomplete"].includes(receipt.finalDisposition)) return { ok: false, code: "malformed-receipt", path: "receipt.finalDisposition" };
  failure = sourceLinksShape(receipt.explorerLinks, "receipt.explorerLinks");
  if (failure) return { ok: false, code: "malformed-receipt", path: failure.path };
  return { ok: true };
}

function agentFailureShape(value, path) {
  let failure = strictObject(value, ["code", "category", "message"], path);
  if (failure) return failure;
  if (!["agent-credentials-missing", "agent-provider-timeout", "agent-provider-error", "agent-output-invalid", "agent-tool-request-invalid", "agent-step-limit"].includes(value.code)) return issue(`${path}.code`);
  if (!["unavailable", "timeout", "provider", "invalid-output", "invalid-tool", "step-limit"].includes(value.category)) return issue(`${path}.category`);
  return stringValue(value.message, `${path}.message`);
}

function agentShape(agent, path) {
  let failure = strictObject(agent, ["status", "provider", "model", "steps", "narrative", "uncertainty", "failure"], path);
  if (failure) return failure;
  if (!["not-run", "unavailable", "failed", "complete"].includes(agent.status)) return issue(`${path}.status`);
  if (agent.provider !== null && agent.provider !== "openrouter") return issue(`${path}.provider`);
  failure = nullable(agent.model, stringValue, `${path}.model`);
  if (failure) return failure;
  failure = arrayValue(agent.steps, `${path}.steps`, (step, stepPath) => {
    let stepFailure = strictObject(step, ["step", "requestedCheckId", "rationale", "toolResultRef", "outcome"], stepPath);
    if (stepFailure) return stepFailure;
    stepFailure = integerValue(step.step, `${stepPath}.step`, 1);
    if (stepFailure || step.step > 3) return stepFailure || issue(`${stepPath}.step`);
    if (!CHECK_IDS.has(step.requestedCheckId)) return issue(`${stepPath}.requestedCheckId`);
    if (!CHECK_IDS.has(step.toolResultRef)) return issue(`${stepPath}.toolResultRef`);
    if (!CHECK_STATUSES.has(step.outcome)) return issue(`${stepPath}.outcome`);
    return stringValue(step.rationale, `${stepPath}.rationale`);
  }, { max: 3 });
  if (failure) return failure;
  failure = nullable(agent.narrative, stringValue, `${path}.narrative`);
  if (failure) return failure;
  failure = nullable(agent.uncertainty, stringValue, `${path}.uncertainty`);
  if (failure) return failure;
  if (agent.failure !== null) {
    failure = agentFailureShape(agent.failure, `${path}.failure`);
    if (failure) return failure;
  }
  if (agent.status === "not-run" && (agent.provider !== null || agent.model !== null || agent.steps.length > 0 || agent.narrative !== null || agent.uncertainty !== null || agent.failure !== null)) return issue(path);
  if ((agent.status === "unavailable" || agent.status === "failed") && agent.failure === null) return issue(`${path}.failure`);
  if (agent.status === "complete" && (agent.failure !== null || agent.narrative === null || agent.uncertainty === null)) return issue(path);
  return null;
}

function evidenceShape(evidence, path) {
  let failure = strictObject(evidence, ["id", "status", "network", "block", "transaction", "log", "event", "relevantAddresses", "detector", "severity", "upgradeInvestigation", "agentInvestigation", "investigationReceipt", "observedFacts", "sources", "errors"], path);
  if (failure) return failure;
  failure = stringValue(evidence.id, `${path}.id`);
  if (failure) return failure;
  if (!["complete", "incomplete"].includes(evidence.status)) return issue(`${path}.status`);
  failure = strictObject(evidence.network, ["name", "chainId"], `${path}.network`);
  if (failure) return failure;
  failure = stringValue(evidence.network.name, `${path}.network.name`) || integerValue(evidence.network.chainId, `${path}.network.chainId`, 1);
  if (failure) return failure;
  failure = strictObject(evidence.block, ["number", "hash", "timestamp"], `${path}.block`);
  if (failure) return failure;
  failure = decimalValue(evidence.block.number, `${path}.block.number`) || hashValue(evidence.block.hash, `${path}.block.hash`);
  if (!failure) failure = nullable(evidence.block.timestamp, isoDate, `${path}.block.timestamp`);
  if (failure) return failure;
  failure = strictObject(evidence.transaction, ["hash", "sender", "recipient", "receiptStatus"], `${path}.transaction`);
  if (failure) return failure;
  failure = hashValue(evidence.transaction.hash, `${path}.transaction.hash`);
  if (!failure) failure = nullable(evidence.transaction.sender, addressValue, `${path}.transaction.sender`);
  if (!failure) failure = nullable(evidence.transaction.recipient, addressValue, `${path}.transaction.recipient`);
  if (!failure && evidence.transaction.receiptStatus !== null && !["success", "reverted"].includes(evidence.transaction.receiptStatus)) failure = issue(`${path}.transaction.receiptStatus`);
  if (failure) return failure;
  failure = strictObject(evidence.log, ["index", "emitter", "topic0", "rawTopics"], `${path}.log`);
  if (failure) return failure;
  failure = decimalValue(evidence.log.index, `${path}.log.index`) || addressValue(evidence.log.emitter, `${path}.log.emitter`) || hashValue(evidence.log.topic0, `${path}.log.topic0`);
  if (!failure) failure = arrayValue(evidence.log.rawTopics, `${path}.log.rawTopics`, hashValue, { min: 1 });
  if (failure) return failure;
  failure = strictObject(evidence.event, ["signature", "decodedArguments"], `${path}.event`);
  if (failure) return failure;
  if (evidence.event.signature !== "Upgraded(address)") return issue(`${path}.event.signature`);
  failure = strictObject(evidence.event.decodedArguments, ["implementation"], `${path}.event.decodedArguments`);
  if (failure) return failure;
  failure = addressValue(evidence.event.decodedArguments.implementation, `${path}.event.decodedArguments.implementation`);
  if (failure) return failure;
  failure = arrayValue(evidence.relevantAddresses, `${path}.relevantAddresses`, (item, itemPath) => {
    let itemFailure = strictObject(item, ["address", "role"], itemPath);
    if (itemFailure) return itemFailure;
    return addressValue(item.address, `${itemPath}.address`) || stringValue(item.role, `${itemPath}.role`);
  }, { min: 1 });
  if (failure) return failure;
  failure = strictObject(evidence.detector, ["id", "inputs"], `${path}.detector`);
  if (failure) return failure;
  failure = stringValue(evidence.detector.id, `${path}.detector.id`) || recordOfStrings(evidence.detector.inputs, `${path}.detector.inputs`);
  if (failure) return failure;
  failure = strictObject(evidence.severity, ["ruleId", "inputs", "result"], `${path}.severity`);
  if (failure) return failure;
  if (!SEVERITY_RULES.has(evidence.severity.ruleId)) return issue(`${path}.severity.ruleId`);
  failure = recordOfStrings(evidence.severity.inputs, `${path}.severity.inputs`);
  if (!failure && !SEVERITIES.has(evidence.severity.result)) failure = issue(`${path}.severity.result`);
  if (failure) return failure;
  failure = strictObject(evidence.upgradeInvestigation, ["plan", "disposition", "evidenceStatus", "checks"], `${path}.upgradeInvestigation`);
  if (failure) return failure;
  failure = planShape(evidence.upgradeInvestigation.plan, `${path}.upgradeInvestigation.plan`);
  if (failure) return failure;
  if (!["corroborated", "contradicted", "incomplete"].includes(evidence.upgradeInvestigation.disposition)) return issue(`${path}.upgradeInvestigation.disposition`);
  if (!["complete", "incomplete"].includes(evidence.upgradeInvestigation.evidenceStatus)) return issue(`${path}.upgradeInvestigation.evidenceStatus`);
  failure = arrayValue(evidence.upgradeInvestigation.checks, `${path}.upgradeInvestigation.checks`, checkShape, { max: 6 });
  if (failure) return failure;
  failure = agentShape(evidence.agentInvestigation, `${path}.agentInvestigation`);
  if (failure) return failure;
  if (evidence.investigationReceipt !== null && !isRecord(evidence.investigationReceipt)) return issue(`${path}.investigationReceipt`);
  failure = arrayValue(evidence.observedFacts, `${path}.observedFacts`, stringValue, { min: 1 });
  if (failure) return failure;
  failure = sourceLinksShape(evidence.sources, `${path}.sources`);
  if (failure) return failure;
  failure = arrayValue(evidence.errors, `${path}.errors`, (item, itemPath) => {
    let itemFailure = strictObject(item, ["code", "message"], itemPath);
    if (itemFailure) return itemFailure;
    return stringValue(item.code, `${itemPath}.code`) || stringValue(item.message, `${itemPath}.message`);
  });
  if (failure) return failure;
  if (evidence.status === "complete" && evidence.errors.length > 0) return issue(`${path}.errors`, "malformed-evidence");
  if (evidence.status === "incomplete" && evidence.errors.length === 0) return issue(`${path}.errors`, "incomplete-evidence");
  return null;
}

function alertShape(alert, path) {
  let failure = strictObject(alert, ["id", "scanId", "targetId", "incidentClass", "eventType", "classificationLabel", "severity", "severityRuleId", "title", "summary", "investigation", "observedAt", "evidenceStatus", "evidenceId", "sources"], path);
  if (failure) return failure;
  for (const key of ["id", "scanId", "targetId", "title", "summary", "evidenceId"]) {
    failure = stringValue(alert[key], `${path}.${key}`);
    if (failure) return failure;
  }
  if (!PROFILE_IDS.has(alert.targetId)) return issue(`${path}.targetId`);
  if (alert.incidentClass !== "contract_upgrade" || alert.eventType !== "proxy_upgraded" || alert.classificationLabel !== "Contract upgrade") return issue(path);
  if (!SEVERITIES.has(alert.severity)) return issue(`${path}.severity`);
  if (!SEVERITY_RULES.has(alert.severityRuleId)) return issue(`${path}.severityRuleId`);
  failure = strictObject(alert.investigation, ["observedFacts", "interpretation", "limitations"], `${path}.investigation`);
  if (failure) return failure;
  failure = arrayValue(alert.investigation.observedFacts, `${path}.investigation.observedFacts`, stringValue, { min: 1 });
  if (failure) return failure;
  failure = strictObject(alert.investigation.interpretation, ["severityRuleId", "text"], `${path}.investigation.interpretation`);
  if (failure) return failure;
  failure = stringValue(alert.investigation.interpretation.severityRuleId, `${path}.investigation.interpretation.severityRuleId`) || stringValue(alert.investigation.interpretation.text, `${path}.investigation.interpretation.text`);
  if (failure) return failure;
  failure = arrayValue(alert.investigation.limitations, `${path}.investigation.limitations`, stringValue, { min: 1 });
  if (failure) return failure;
  failure = nullable(alert.observedAt, isoDate, `${path}.observedAt`);
  if (failure) return failure;
  if (!["complete", "incomplete"].includes(alert.evidenceStatus)) return issue(`${path}.evidenceStatus`);
  return sourceLinksShape(alert.sources, `${path}.sources`);
}

function scanShape(scan) {
  let failure = strictObject(scan, ["scanId", "targetId", "range", "status", "alerts", "evidence", "failures"], "scanResult");
  if (failure) return failure;
  failure = stringValue(scan.scanId, "scanResult.scanId") || stringValue(scan.targetId, "scanResult.targetId");
  if (failure) return failure;
  if (!PROFILE_IDS.has(scan.targetId)) return issue("scanResult.targetId");
  failure = strictObject(scan.range, ["fromBlock", "toBlock"], "scanResult.range");
  if (failure) return failure;
  failure = decimalValue(scan.range.fromBlock, "scanResult.range.fromBlock") || decimalValue(scan.range.toBlock, "scanResult.range.toBlock");
  if (failure) return failure;
  if (!["complete", "partial", "failed"].includes(scan.status)) return issue("scanResult.status");
  failure = arrayValue(scan.alerts, "scanResult.alerts", alertShape);
  if (failure) return failure;
  failure = arrayValue(scan.evidence, "scanResult.evidence", evidenceShape);
  if (failure) return failure;
  if (scan.evidence.length > 1) return issue("scanResult.evidence");
  failure = arrayValue(scan.failures, "scanResult.failures", (value, path) => {
    let itemFailure = strictObjectWithOptional(value, ["code", "stage", "message"], ["category", "blockNumber", "transactionHash", "logIndex"], path);
    if (itemFailure) return itemFailure;
    itemFailure = stringValue(value.code, `${path}.code`);
    if (itemFailure) return itemFailure;
    if (!["validation", "rpc", "decode", "evidence"].includes(value.stage)) return issue(`${path}.stage`);
    if (Object.hasOwn(value, "category") && !["dns", "timeout", "rate-limit", "wrong-chain", "malformed-response", "incomplete-evidence", "unsupported", "unavailable"].includes(value.category)) return issue(`${path}.category`);
    if (Object.hasOwn(value, "blockNumber")) itemFailure = decimalValue(value.blockNumber, `${path}.blockNumber`);
    if (!itemFailure && Object.hasOwn(value, "transactionHash")) itemFailure = hashValue(value.transactionHash, `${path}.transactionHash`);
    if (!itemFailure && Object.hasOwn(value, "logIndex")) itemFailure = decimalValue(value.logIndex, `${path}.logIndex`);
    if (!itemFailure) itemFailure = stringValue(value.message, `${path}.message`);
    return itemFailure;
  });
  return failure;
}

function sourceConsistent(source) {
  return (source.declared === "live" && source.provenance === "live-rpc")
    || (source.declared === "fixture" && source.provenance === "verified-fixture");
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalArtifactPayload(artifact) {
  if (!isRecord(artifact)) throw new TypeError("Expected an artifact object.");
  const { artifactId: _artifactId, ...payload } = artifact;
  return normalizeEvmAddresses(payload);
}

export async function createPortableArtifactId(artifact) {
  return `artifact_${await sha256Hex(stableSerialize(canonicalArtifactPayload(artifact)))}`;
}

export async function createPortableArtifact(scanResult, source) {
  const artifact = {
    format: PORTABLE_INTEGRITY_FORMAT,
    artifactVersion: PORTABLE_INTEGRITY_VERSION,
    source,
    scanResult,
  };
  return { ...artifact, artifactId: await createPortableArtifactId(artifact) };
}

async function createScanId(targetId, fromBlock, toBlock) {
  return `scan_${await sha256Hex(["8453", targetId, fromBlock, toBlock].join("\n"))}`;
}

export async function createPortableAlertId(chainId, transactionHash, logIndex, detectorId) {
  return `alert_${await sha256Hex([String(chainId), transactionHash.toLowerCase(), String(logIndex), detectorId].join("\n"))}`;
}

function comparison(path, expected, observed, code = "evidence-mismatch") {
  const available = observed !== undefined && (observed !== null || expected === null);
  return {
    path,
    expected: expected ?? null,
    observed: available ? observed : null,
    status: available ? (equal(expected, observed) ? "matched" : "mismatch") : "unavailable",
    code: available && equal(expected, observed) ? null : code,
  };
}

function comparisonSet(comparisons) {
  return {
    matchedPaths: comparisons.filter(({ status }) => status === "matched").map(({ path }) => path),
    failedPaths: comparisons.filter(({ status }) => status !== "matched").map(({ path }) => path),
  };
}

function profileFor(targetId) {
  return archiveProfiles.find(({ id }) => id === targetId) ?? null;
}

function expectedSeverity(implementation, profile) {
  return implementation.toLowerCase() === profile.implementation.toLowerCase()
    ? "informational"
    : /^0x0{40}$/i.test(implementation)
      ? "high"
      : "suspicious";
}

function expectedSeverityRule(implementation, profile) {
  return implementation.toLowerCase() === profile.implementation.toLowerCase()
    ? "target-is-approved"
    : /^0x0{40}$/i.test(implementation)
      ? "target-is-zero-address"
      : "target-is-not-approved";
}

function expectedSeverityInputs(implementation, profile) {
  const normalized = implementation.toLowerCase();
  const approved = normalized === profile.implementation.toLowerCase();
  return {
    implementation,
    approved: String(approved),
    isZeroAddress: String(/^0x0{40}$/i.test(implementation)),
  };
}

function expectedCheckParameters(profileCheck, implementation) {
  if (profileCheck.id === "implementation-bytecode") return { address: implementation };
  return profileCheck.parameters;
}

function resultProjection(value) {
  if (value === null) return null;
  if (value.kind === "bytecode") return { present: value.present, byteLength: value.byteLength };
  return value.value;
}

function expectedCheckStatus(profileCheck, observedCheck, implementation, profile) {
  if (observedCheck.result === null) return observedCheck.status === "unsupported" ? "unsupported" : "failed";
  const expected = resultProjection(profileCheck.result);
  const observed = resultProjection(observedCheck.result);
  const approvedImplementation = implementation.toLowerCase() === profile.implementation.toLowerCase();
  return equal(expected, observed)
    && (profileCheck.id !== "implementation-bytecode" || approvedImplementation)
    ? "passed"
    : "mismatch";
}

function expectedAssertionActual(check) {
  if (check.result === null) return null;
  if (check.result.kind === "bytecode") return `${check.result.byteLength} bytes`;
  return check.result.value;
}

function checkComparisons(expectedChecks, observedChecks, implementation, profile, planId) {
  const comparisons = [];
  const contradictionPaths = new Set();
  if (!Array.isArray(observedChecks) || observedChecks.length !== expectedChecks.length) {
    comparisons.push(comparison("checks", expectedChecks.map(({ id }) => id), Array.isArray(observedChecks) ? observedChecks.map((check) => check?.id ?? null) : observedChecks, "check-results-mismatch"));
    return { comparisons, contradictionPaths, structuralMismatch: true, derivedDisposition: null };
  }
  for (let index = 0; index < expectedChecks.length; index += 1) {
    const expected = expectedChecks[index];
    const observed = observedChecks[index];
    const prefix = `checks[${index}]`;
    comparisons.push(
      comparison(`${prefix}.id`, expected.id, observed.id, "check-out-of-scope"),
      comparison(`${prefix}.required`, expected.required, observed.required, "check-required-mismatch"),
      comparison(`${prefix}.method`, expected.method, observed.method, "check-method-mismatch"),
      comparison(`${prefix}.blockTag`, expected.blockTag, observed.blockTag, "check-block-mismatch"),
      comparison(`${prefix}.parameters`, expectedCheckParameters(expected, implementation), observed.parameters, "check-parameters-mismatch"),
      comparison(`${prefix}.assertion.description`, expected.assertion.description, observed.assertion.description, "check-assertion-mismatch"),
      comparison(`${prefix}.assertion.expected`, expected.assertion.expected, observed.assertion.expected, "check-assertion-mismatch"),
      comparison(`${prefix}.result`, resultProjection(expected.result), resultProjection(observed.result), "check-result-mismatch"),
      comparison(`${prefix}.status`, expectedCheckStatus(expected, observed, implementation, profile), observed.status, "check-status-mismatch"),
      comparison(`${prefix}.assertion.actual`, expectedAssertionActual(observed), observed.assertion.actual, "check-assertion-mismatch"),
      comparison(`${prefix}.assertion.matches`, observed.status === "passed" ? true : observed.status === "mismatch" ? false : null, observed.assertion.matches, "check-assertion-mismatch"),
      comparison(`${prefix}.failure`, ["failed", "unsupported"].includes(observed.status) ? "present" : null, observed.failure === null ? null : "present", "check-failure-mismatch"),
    );
    const resultComparison = comparisons.find(({ path }) => path === `${prefix}.result`);
    const statusComparison = comparisons.find(({ path }) => path === `${prefix}.status`);
    const structuralFields = comparisons.filter(({ path }) => [
      `${prefix}.id`, `${prefix}.required`, `${prefix}.method`, `${prefix}.blockTag`, `${prefix}.parameters`,
      `${prefix}.assertion.description`, `${prefix}.assertion.expected`, `${prefix}.status`, `${prefix}.assertion.actual`,
      `${prefix}.assertion.matches`, `${prefix}.failure`,
    ].includes(path));
    if (resultComparison?.status === "mismatch" && statusComparison?.status === "matched" && structuralFields.every(({ status }) => status === "matched")) {
      contradictionPaths.add(`${prefix}.result`);
    }
  }
  const expectedIds = expectedChecks.map(({ id }) => id);
  const observedIds = observedChecks.map(({ id }) => id);
  if (!equal(expectedIds, observedIds)) comparisons.push(comparison("checks", expectedIds, observedIds, "check-order-mismatch"));
  const structuralPaths = new Set([
    "id", "required", "method", "blockTag", "parameters", "assertion.description", "assertion.expected",
    "status", "assertion.actual", "assertion.matches", "failure",
  ]);
  const structuralMismatch = comparisons.some(({ path, status }) => status === "mismatch"
    && (path === "checks" || [...structuralPaths].some((suffix) => path.endsWith(`.${suffix}`))));
  const requiredChecks = observedChecks.filter(({ required }) => required);
  const derivedDisposition = expectedChecks.length === 0
    ? null
    : planId === "stop-incomplete"
      ? "incomplete"
      : requiredChecks.some(({ status }) => status === "mismatch")
        ? "contradicted"
        : requiredChecks.some(({ status }) => status === "failed" || status === "unsupported")
          ? "incomplete"
          : "corroborated";
  return { comparisons, contradictionPaths, structuralMismatch, derivedDisposition };
}

function failedComparisons(comparisons) {
  return comparisons.filter(({ status }) => status !== "matched");
}

function baseDetails(artifact, receipt, computedReceiptId, comparisons) {
  const paths = comparisonSet(comparisons);
  return {
    artifactId: artifact.artifactId,
    computedArtifactId: artifact.artifactId,
    receiptId: receipt?.receiptId ?? null,
    computedReceiptId,
    ...paths,
  };
}

async function alertComparisons(scan, evidence, profile, severity, severityRule) {
  const comparisons = [];
  const requiresAlert = scan.status === "complete" && evidence.status === "complete";
  if (requiresAlert) {
    comparisons.push(comparison("alerts", 1, scan.alerts.length, "alert-cardinality-mismatch"));
  }
  if (scan.alerts.length !== 1) return comparisons;
  const alert = scan.alerts[0];
  comparisons.push(
    comparison("alerts[0].id", await createPortableAlertId(8453, evidence.transaction.hash, evidence.log.index, evidence.detector.id), alert.id, "alert-identity-mismatch"),
    comparison("alerts[0].scanId", scan.scanId, alert.scanId, "alert-scan-mismatch"),
    comparison("alerts[0].targetId", scan.targetId, alert.targetId, "alert-target-mismatch"),
    comparison("alerts[0].evidenceId", evidence.id, alert.evidenceId, "alert-evidence-mismatch"),
    comparison("alerts[0].severity", severity, alert.severity, "alert-severity-mismatch"),
    comparison("alerts[0].severityRuleId", severityRule, alert.severityRuleId, "alert-severity-rule-mismatch"),
    comparison("alerts[0].investigation.interpretation.severityRuleId", severityRule, alert.investigation.interpretation.severityRuleId, "alert-severity-rule-mismatch"),
    comparison("alerts[0].evidenceStatus", evidence.status, alert.evidenceStatus, "alert-status-mismatch"),
    comparison("alerts[0].sources", evidence.sources, alert.sources, "alert-sources-mismatch"),
  );
  return comparisons;
}

function artifactEnvelopeShape(artifact) {
  const failure = strictObject(artifact, ["format", "artifactVersion", "artifactId", "source", "scanResult"], "artifact");
  if (failure) return failure;
  if (artifact.format !== PORTABLE_INTEGRITY_FORMAT) return issue("artifact.format", "wrong-format");
  if (artifact.artifactVersion !== PORTABLE_INTEGRITY_VERSION) return issue("artifact.artifactVersion", "unsupported-artifact-version");
  if (!ARTIFACT_ID_PATTERN.test(artifact.artifactId ?? "")) return issue("artifact.artifactId");
  const sourceFailure = strictObject(artifact.source, ["declared", "provenance"], "artifact.source");
  if (sourceFailure) return sourceFailure;
  if (!["live", "fixture"].includes(artifact.source.declared)) return issue("artifact.source.declared");
  if (!["live-rpc", "verified-fixture"].includes(artifact.source.provenance)) return issue("artifact.source.provenance");
  return scanShape(artifact.scanResult);
}

async function verifyPortableIntegrityArtifactUnsafe(artifact) {
  if (!isRecord(artifact)) return malformed("The selected JSON value is not a portable integrity artifact.");
  const envelopeFailure = artifactEnvelopeShape(artifact);
  if (envelopeFailure) {
    if (envelopeFailure.code === "wrong-format") return result("refused", null, "wrong-format");
    if (envelopeFailure.code === "unsupported-artifact-version") return result("refused", null, "unsupported-artifact-version");
    if (envelopeFailure.code === "malformed-evidence") {
      return result("verified", "EVIDENCE_MISMATCH", "malformed-evidence", { failedPaths: [envelopeFailure.path] });
    }
    if (envelopeFailure.code === "incomplete-evidence") {
      return result("verified", "INCOMPLETE", "incomplete-evidence", { failedPaths: [envelopeFailure.path] });
    }
    return malformed(`Portable artifact validation failed at ${envelopeFailure.path}.`, { failedPaths: [envelopeFailure.path] });
  }

  let computedArtifactId;
  try {
    computedArtifactId = await createPortableArtifactId(artifact);
  } catch {
    return malformed("The portable artifact could not be canonically serialized.");
  }
  if (computedArtifactId !== artifact.artifactId) return result("refused", null, "artifact-id-mismatch", { artifactId: artifact.artifactId, computedArtifactId });

  const scan = artifact.scanResult;
  const profile = profileFor(scan.targetId);
  const scanComparisons = [
    comparison("target.profileId", profile?.id ?? archiveProfiles.map(({ id }) => id), scan.targetId, "target-profile-mismatch"),
    comparison("scan.range.fromBlock", profile?.block.number ?? null, scan.range.fromBlock, "block-range-mismatch"),
    comparison("scan.range.toBlock", profile?.block.number ?? null, scan.range.toBlock, "block-range-mismatch"),
  ];
  const expectedScanId = await createScanId(scan.targetId, scan.range.fromBlock, scan.range.toBlock);
  scanComparisons.push(comparison("scan.scanId", expectedScanId, scan.scanId, "scan-id-mismatch"));
  const sourceComparison = comparison("source.provenance", artifact.source.declared === "live" ? "live-rpc" : "verified-fixture", artifact.source.provenance, artifact.source.declared === "live" ? "fixture-presented-as-live" : "live-presented-as-fixture");
  scanComparisons.push(sourceComparison);
  if (!sourceConsistent(artifact.source)) {
    const paths = comparisonSet([sourceComparison]);
    return result("refused", "EVIDENCE_MISMATCH", sourceComparison.code, { artifactId: artifact.artifactId, computedArtifactId, ...paths });
  }

  const failures = scan.failures;
  const rpcFailure = failures.find((failure) => RPC_CATEGORIES.has(failure.category));
  if (scan.evidence.length === 0) return result("verified", rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure ? `rpc-${rpcFailure.category}` : "missing-evidence", { ...baseDetails(artifact, null, null, scanComparisons) });
  const evidence = scan.evidence[0];
  const receipt = evidence.investigationReceipt;
  if (!receipt) return result("verified", rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure ? `rpc-${rpcFailure.category}` : "missing-receipt", { ...baseDetails(artifact, null, null, scanComparisons) });
  const receiptState = receiptShape(receipt);
  if (!receiptState.ok) return result("verified", "INVALID_RECEIPT", receiptState.code, { artifactId: artifact.artifactId, computedArtifactId, receiptId: receipt.receiptId ?? null, failedPaths: [receiptState.path] });
  let computedReceiptId;
  try {
    computedReceiptId = await createReceiptId(receipt);
  } catch {
    return result("verified", "INVALID_RECEIPT", "malformed-receipt", { artifactId: artifact.artifactId, computedArtifactId, receiptId: receipt.receiptId, failedPaths: ["receipt"] });
  }
  if (computedReceiptId !== receipt.receiptId) return result("verified", "INVALID_RECEIPT", "receipt-id-mismatch", { artifactId: artifact.artifactId, computedArtifactId, receiptId: receipt.receiptId, computedReceiptId, failedPaths: ["receipt.receiptId"] });
  if (!profile) return result("verified", "EVIDENCE_MISMATCH", "target-profile-mismatch", baseDetails(artifact, receipt, computedReceiptId, scanComparisons));

  const trigger = receipt.trigger;
  const implementation = evidence.event.decodedArguments.implementation;
  const severity = expectedSeverity(implementation, profile);
  const severityRule = expectedSeverityRule(implementation, profile);
  const expectedChecks = profile.checks.filter(({ id }) => receipt.plan.selectedChecks.includes(id));
  const checkState = checkComparisons(expectedChecks, evidence.upgradeInvestigation.checks, implementation, profile, receipt.plan.id);
  const evidenceComparisons = [
    ...scanComparisons,
    comparison("network.name", profile.receipt.trigger.network.name, evidence.network.name, "network-mismatch"),
    comparison("network.chainId", profile.receipt.trigger.network.chainId, evidence.network.chainId, "chain-id-mismatch"),
    comparison("block.number", profile.block.number, evidence.block.number, "block-number-mismatch"),
    comparison("block.hash", profile.block.hash, evidence.block.hash, "block-hash-mismatch"),
    comparison("block.timestamp", profile.block.timestamp, evidence.block.timestamp, "block-timestamp-mismatch"),
    comparison("transaction.hash", profile.transaction.hash, evidence.transaction.hash, "transaction-hash-mismatch"),
    comparison("transaction.sender", profile.transaction.sender, evidence.transaction.sender, "transaction-sender-mismatch"),
    comparison("transaction.recipient", profile.transaction.recipient, evidence.transaction.recipient, "transaction-recipient-mismatch"),
    comparison("transaction.receiptStatus", "success", evidence.transaction.receiptStatus, "transaction-status-mismatch"),
    comparison("log.index", profile.receipt.trigger.log.index, evidence.log.index, "log-index-mismatch"),
    comparison("log.emitter", profile.emitter, evidence.log.emitter, "event-emitter-mismatch"),
    comparison("log.topic0", profile.receipt.trigger.log.topic0, evidence.log.topic0, "event-topic-mismatch"),
    comparison("log.rawTopics", profile.receipt.trigger.log.rawTopics, evidence.log.rawTopics, "event-topics-mismatch"),
    comparison("event.signature", profile.receipt.trigger.eventSignature, evidence.event.signature, "event-signature-mismatch"),
    comparison("event.decodedArguments.implementation", profile.implementation, implementation, "implementation-mismatch"),
    comparison("relevantAddresses", profile.addresses.map(({ address, role }) => ({ address, role })), evidence.relevantAddresses, "address-role-mismatch"),
    comparison("detector.id", profile.detectorId, evidence.detector.id, "detector-mismatch"),
    comparison("detector.inputs", { configuredEmitter: profile.emitter, configuredTopic0: profile.receipt.trigger.log.topic0 }, evidence.detector.inputs, "detector-input-mismatch"),
    comparison("severity.ruleId", severityRule, evidence.severity.ruleId, "severity-rule-mismatch"),
    comparison("severity.inputs", expectedSeverityInputs(implementation, profile), evidence.severity.inputs, "severity-input-mismatch"),
    comparison("severity.result", severity, evidence.severity.result, "severity-mismatch"),
    comparison("investigation.plan", profile.receipt.plan, evidence.upgradeInvestigation.plan, "plan-out-of-scope"),
    comparison("investigation.disposition", evidence.upgradeInvestigation.disposition, receipt.finalDisposition, "disposition-mismatch"),
    comparison("sources", profile.receipt.explorerLinks, evidence.sources, "explorer-links-mismatch"),
    comparison("receipt.trigger.network", evidence.network, trigger.network, "receipt-trigger-network-mismatch"),
    comparison("target.profileId", scan.targetId, trigger.targetId, "target-profile-mismatch"),
    comparison("receipt.trigger.targetId", scan.targetId, trigger.targetId, "target-profile-mismatch"),
    comparison("receipt.trigger.incidentClass", "contract_upgrade", trigger.incidentClass, "receipt-trigger-incident-mismatch"),
    comparison("receipt.trigger.eventType", "proxy_upgraded", trigger.eventType, "receipt-trigger-event-type-mismatch"),
    comparison("receipt.trigger.eventSignature", evidence.event.signature, trigger.eventSignature, "event-signature-mismatch"),
    comparison("receipt.trigger.decodedArguments", evidence.event.decodedArguments, trigger.decodedArguments, "implementation-mismatch"),
    comparison("receipt.trigger.block", evidence.block, trigger.block, "receipt-trigger-block-mismatch"),
    comparison("receipt.trigger.block.number", evidence.block.number, trigger.block.number, "block-number-mismatch"),
    comparison("receipt.trigger.block.hash", evidence.block.hash, trigger.block.hash, "block-hash-mismatch"),
    comparison("receipt.trigger.block.timestamp", evidence.block.timestamp, trigger.block.timestamp, "block-timestamp-mismatch"),
    comparison("receipt.trigger.transaction", evidence.transaction, trigger.transaction, "receipt-trigger-transaction-mismatch"),
    comparison("receipt.trigger.transaction.hash", evidence.transaction.hash, trigger.transaction.hash, "transaction-hash-mismatch"),
    comparison("receipt.trigger.transaction.sender", evidence.transaction.sender, trigger.transaction.sender, "transaction-sender-mismatch"),
    comparison("receipt.trigger.transaction.recipient", evidence.transaction.recipient, trigger.transaction.recipient, "transaction-recipient-mismatch"),
    comparison("receipt.trigger.transaction.receiptStatus", evidence.transaction.receiptStatus, trigger.transaction.receiptStatus, "transaction-status-mismatch"),
    comparison("receipt.trigger.log", evidence.log, trigger.log, "receipt-trigger-log-mismatch"),
    comparison("receipt.trigger.log.index", evidence.log.index, trigger.log.index, "log-index-mismatch"),
    comparison("receipt.trigger.log.emitter", evidence.log.emitter, trigger.log.emitter, "event-emitter-mismatch"),
    comparison("receipt.trigger.log.topic0", evidence.log.topic0, trigger.log.topic0, "event-topic-mismatch"),
    comparison("receipt.trigger.log.rawTopics", evidence.log.rawTopics, trigger.log.rawTopics, "event-topics-mismatch"),
    comparison("receipt.trigger.detector.id", profile.detectorId, trigger.detector.id, "detector-mismatch"),
    comparison("receipt.trigger.detector.severityRuleId", severityRule, trigger.detector.severityRuleId, "detector-severity-rule-mismatch"),
    comparison("receipt.trigger.detector.severity", severity, trigger.detector.severity, "detector-severity-mismatch"),
    comparison("receipt.plan", evidence.upgradeInvestigation.plan, receipt.plan, "plan-mismatch"),
    comparison("receipt.checks", evidence.upgradeInvestigation.checks, receipt.checks, "check-results-mismatch"),
    comparison("receipt.errors", evidence.upgradeInvestigation.checks.flatMap((check) => check.failure ? [check.failure] : []), receipt.errors, "receipt-errors-mismatch"),
    comparison("receipt.limitations", profile.receipt.limitations, receipt.limitations, "receipt-limitations-mismatch"),
    comparison("receipt.explorerLinks", evidence.sources, receipt.explorerLinks, "explorer-links-mismatch"),
    comparison("receipt.finalDisposition", evidence.upgradeInvestigation.disposition, receipt.finalDisposition, "disposition-mismatch"),
    ...checkState.comparisons,
  ];
  evidenceComparisons.push(...await alertComparisons(scan, evidence, profile, severity, severityRule));
  for (let index = 0; index < Math.max(profile.addresses.length, evidence.relevantAddresses.length); index += 1) {
    const expectedAddress = profile.addresses[index];
    const observedAddress = evidence.relevantAddresses[index];
    evidenceComparisons.push(
      comparison(`relevantAddresses[${index}].address`, expectedAddress?.address, observedAddress?.address, "address-role-mismatch"),
      comparison(`relevantAddresses[${index}].role`, expectedAddress?.role, observedAddress?.role, "address-role-mismatch"),
    );
  }
  evidenceComparisons.push(
    comparison("sources.transaction", profile.receipt.explorerLinks.transaction, evidence.sources.transaction, "explorer-links-mismatch"),
    comparison("sources.block", profile.receipt.explorerLinks.block, evidence.sources.block, "explorer-links-mismatch"),
  );
  const failed = failedComparisons(evidenceComparisons);
  const disposition = evidence.upgradeInvestigation.disposition;
  if (!checkState.structuralMismatch && checkState.derivedDisposition
    && (disposition !== checkState.derivedDisposition || receipt.finalDisposition !== checkState.derivedDisposition)) {
    return result("verified", "INVALID_RECEIPT", "malformed-receipt", {
      ...baseDetails(artifact, receipt, computedReceiptId, evidenceComparisons),
      failedPaths: ["finalDisposition"],
    });
  }
  const structuralFailure = failed.some(({ path }) => {
    if (path === "event.decodedArguments.implementation" && disposition === "contradicted") return false;
    if (path === "receipt.trigger.decodedArguments" && disposition === "contradicted") return false;
    return !checkState.contradictionPaths.has(path);
  });
  const contradiction = disposition === "contradicted"
    && failed.length > 0
    && !structuralFailure
    && (failed.some(({ path }) => path === "event.decodedArguments.implementation" || path === "receipt.trigger.decodedArguments") || [...checkState.contradictionPaths].some((path) => failed.some((comparisonValue) => comparisonValue.path === path)));
  const details = baseDetails(artifact, receipt, computedReceiptId, evidenceComparisons);
  if (structuralFailure || (!contradiction && failed.length > 0)) return result("verified", "EVIDENCE_MISMATCH", "evidence-mismatch", details);
  const incomplete = scan.status !== "complete"
    || failures.length > 0
    || evidence.status !== "complete"
    || evidence.upgradeInvestigation.evidenceStatus !== "complete"
    || disposition === "incomplete"
    || evidence.upgradeInvestigation.checks.some(({ status }) => status === "failed" || status === "unsupported");
  if (incomplete) return result("verified", rpcFailure ? "RPC_UNAVAILABLE" : "INCOMPLETE", rpcFailure ? `rpc-${rpcFailure.category}` : "incomplete-evidence", details);
  if (contradiction) return result("verified", "CONTRADICTED", null, details);
  return result("verified", artifact.source.declared === "fixture" ? "FIXTURE_ONLY" : "CORROBORATED", null, details);
}

export async function verifyPortableIntegrityArtifact(artifact) {
  try {
    return await verifyPortableIntegrityArtifactUnsafe(artifact);
  } catch {
    return malformed("The portable artifact could not be safely verified.");
  }
}

export async function verifyPortableIntegrityText(text) {
  if (typeof text !== "string" || text.trim().length === 0) return malformed("The selected file is empty or does not contain JSON.");
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch {
    return malformed("The selected file is not valid JSON.");
  }
  return verifyPortableIntegrityArtifact(artifact);
}
