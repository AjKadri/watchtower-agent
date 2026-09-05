import { archiveProfiles, getArchiveProfile } from "/archive-data.js";
import { watchtowerFaq } from "/faq-data.js";
import { verifyReceipt } from "/receipt-verifier.js";
import {
  buildArchiveEntries,
  buildEvidenceRows,
  buildFixtureDetail,
  buildInvestigationTrace,
  buildProfileOptions,
  fetchHealth,
  formatUtcTimestamp,
  investigationStateLabel,
  isStructuredScanResult,
  summarizeTraceProgression,
} from "/view-model.js";

const elements = {
  activeProfileNote: document.querySelector("#active-profile-note"),
  archiveBody: document.querySelector("#archive-body"),
  archiveEmpty: document.querySelector("#archive-empty"),
  caseChecks: document.querySelector("#case-checks"),
  caseDisposition: document.querySelector("#case-disposition"),
  caseEvent: document.querySelector("#case-event"),
  caseJourney: document.querySelector("#case-journey"),
  casePlan: document.querySelector("#case-plan"),
  caseProfileId: document.querySelector("#case-profile-id"),
  caseProtocol: document.querySelector("#case-protocol"),
  caseReceipt: document.querySelector("#case-receipt"),
  caseStatus: document.querySelector("#case-status"),
  caseTarget: document.querySelector("#case-target"),
  detail: document.querySelector("#detail-panel"),
  failureList: document.querySelector("#failure-list"),
  failurePanel: document.querySelector("#failure-panel"),
  healthDot: document.querySelector("#health-dot"),
  healthLabel: document.querySelector("#health-label"),
  profileSelector: document.querySelector("#profile-selector"),
  scanButton: document.querySelector("#scan-button"),
  scanStatus: document.querySelector("#scan-status"),
  sourceBadge: document.querySelector("#source-badge"),
};

const state = {
  activeProfileId: null,
  selectedProfileId: null,
  config: null,
  liveDetails: new Map(),
};

const themePreferenceKey = "watchtower-theme";

function applyTheme(theme) {
  const selectedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selectedTheme;
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;
  const dark = selectedTheme === "dark";
  toggle.setAttribute("aria-pressed", String(dark));
  toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

function initializeTheme() {
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;
  let savedTheme;
  try {
    savedTheme = localStorage.getItem(themePreferenceKey);
  } catch {
    savedTheme = null;
  }
  const initialTheme = savedTheme === "dark" || savedTheme === "light"
    ? savedTheme
    : window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  applyTheme(initialTheme);
  toggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem(themePreferenceKey, nextTheme);
    } catch {
      // The selected theme remains active when storage is unavailable.
    }
  });
}

function createHomepageFaqItem(entry, index) {
  const item = node("article", `faq-item${index === 0 ? " is-open" : ""}`);
  item.dataset.faqItem = "";

  const questionId = `faq-question-${entry.id}`;
  const answerId = `faq-answer-${entry.id}`;
  const heading = node("h3");
  const trigger = node("button", "faq-trigger");
  trigger.id = questionId;
  trigger.type = "button";
  trigger.dataset.faqTrigger = "";
  trigger.setAttribute("aria-expanded", String(index === 0));
  trigger.setAttribute("aria-controls", answerId);
  trigger.append(node("span", "", entry.question));
  const icon = node("span", "faq-icon");
  icon.setAttribute("aria-hidden", "true");
  trigger.append(icon);
  heading.append(trigger);

  const answer = node("div", "faq-answer");
  answer.id = answerId;
  answer.setAttribute("role", "region");
  answer.setAttribute("aria-labelledby", questionId);
  answer.setAttribute("aria-hidden", String(index !== 0));
  const answerInner = node("div");
  answerInner.append(node("p", "", entry.shortAnswer));
  answer.append(answerInner);
  item.append(heading, answer);
  return item;
}

function initializeFaq() {
  const list = document.querySelector("[data-faq-list]");
  if (!list) return;
  list.replaceChildren(...watchtowerFaq.map(createHomepageFaqItem));
  const items = [...list.querySelectorAll("[data-faq-item]")];
  if (items.length === 0) return;

  const setItemState = (item, open) => {
    const trigger = item.querySelector("[data-faq-trigger]");
    const answer = item.querySelector(".faq-answer");
    if (!trigger || !answer) return;
    item.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    answer.setAttribute("aria-hidden", String(!open));
  };

  items.forEach((item) => {
    const trigger = item.querySelector("[data-faq-trigger]");
    if (!trigger) return;
    trigger.addEventListener("click", () => {
      const open = !item.classList.contains("is-open");
      items.forEach((other) => setItemState(other, other === item && open));
    });
  });
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const statusIcons = {
  complete: "✓",
  passed: "✓",
  corroborated: "✓",
  informational: "i",
  pending: "~",
  incomplete: "?",
  skipped: "–",
  failed: "×",
  mismatch: "×",
  contradicted: "×",
  unsupported: "?",
  suspicious: "!",
  high: "!",
};

function statusToken(label, variant) {
  const candidates = `${variant} ${label}`.toLowerCase().split(/\s+/);
  return candidates.find((candidate) => Object.hasOwn(statusIcons, candidate)) ?? "pending";
}

function badge(label, variant = label) {
  const token = statusToken(label, variant);
  const element = node("span", `badge ${variant}`);
  element.dataset.status = token;
  const icon = node("span", "badge-icon", statusIcons[token]);
  icon.setAttribute("aria-hidden", "true");
  element.append(icon, document.createTextNode(label));
  return element;
}

function sourceLink(label, href, className = "source-link") {
  const link = node("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function sourceStateVariant(label) {
  return label === "Live RPC investigation"
    ? "live"
    : label === "Verified fixture replay"
      ? "fixture"
      : label === "Failed investigation"
        ? "failed"
        : "incomplete";
}

function createSourceBadge(label, className = "source-badge") {
  const element = node("span", `${className} ${sourceStateVariant(label)}`);
  const marker = node("span", "source-marker");
  marker.setAttribute("aria-hidden", "true");
  element.append(marker, document.createTextNode(label));
  return element;
}

async function request(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? "Request failed.");
    error.payload = payload;
    throw error;
  }
  return payload;
}

function renderFailures(failures = []) {
  elements.failureList.replaceChildren();
  elements.failurePanel.hidden = failures.length === 0;
  for (const failure of failures) {
    const location = [failure.blockNumber && `block ${failure.blockNumber}`, failure.logIndex && `log ${failure.logIndex}`]
      .filter(Boolean)
      .join(", ");
    elements.failureList.append(node("li", "", `${failure.code}: ${failure.message}${location ? ` (${location})` : ""}`));
  }
}

function setSourceBadge(detail, source) {
  const label = investigationStateLabel(detail, source);
  const sourceBadge = createSourceBadge(label);
  elements.sourceBadge.className = sourceBadge.className;
  elements.sourceBadge.replaceChildren(...sourceBadge.childNodes);
}

function renderProfiles() {
  elements.profileSelector.replaceChildren();
  for (const option of buildProfileOptions(archiveProfiles, state.activeProfileId)) {
    const button = node("button", `profile-option${option.id === state.selectedProfileId ? " selected" : ""}`);
    button.type = "button";
    button.dataset.profileId = option.id;
    button.dataset.profileSource = option.isActive ? "live-available" : "verified-fixture";
    button.setAttribute("aria-pressed", String(option.id === state.selectedProfileId));
    const index = node("span", "profile-index", String(option.index).padStart(2, "0"));
    const copy = node("span", "profile-copy");
    copy.append(
      node("span", "profile-name", option.protocol),
      node("span", "profile-product", option.product),
      node("span", "profile-network", "Base mainnet · read-only"),
      node("span", "profile-purpose", option.targetPurpose),
    );
    const metadata = node("span", "profile-metadata");
    metadata.append(
      node("span", `profile-mode ${option.isActive ? "active" : "fixture"}`, option.availability),
      node("span", "profile-id", option.id),
    );
    const action = node("span", "profile-select-label", option.id === state.selectedProfileId ? "Selected" : "Select");
    button.append(index, copy, metadata, action);
    button.addEventListener("click", () => selectProfile(option.id));
    elements.profileSelector.append(button);
  }
}

function renderArchive() {
  const entries = buildArchiveEntries(archiveProfiles);
  elements.archiveBody.replaceChildren();
  elements.archiveEmpty.hidden = entries.length > 0;
  elements.archiveBody.closest(".archive-table-wrap").hidden = entries.length === 0;
  for (const entry of entries) {
    const row = node("tr");
    const protocol = node("td");
    protocol.dataset.label = "Protocol";
    protocol.append(
      node("strong", "", entry.protocol),
      node("span", "archive-source-label", entry.sourceLabel),
      node("span", "archive-profile-id", entry.profileId),
    );
    const event = node("td", "mono", entry.event);
    event.dataset.label = "Event";
    const block = node("td");
    block.dataset.label = "Block and date";
    block.append(sourceLink(entry.block, entry.blockLink, "archive-block-link mono"), node("span", "archive-date", formatUtcTimestamp(entry.timestamp)));
    const disposition = node("td");
    disposition.dataset.label = "Disposition";
    disposition.append(badge(entry.disposition));
    const checks = node("td", "mono");
    checks.dataset.label = "Checks";
    const checkCounts = node("span", "archive-check-counts");
    for (const status of ["passed", "failed", "incomplete", "skipped"]) {
      checkCounts.append(node("span", `archive-check-count ${status}`, `${entry.checkCounts[status]} ${status}`));
    }
    checks.append(checkCounts);
    const receipt = node("td", "receipt-cell");
    receipt.dataset.label = "Receipt";
    const receiptId = node("code", "archive-receipt-id", entry.receiptId);
    const copyStatus = node("span", "copy-status", "");
    copyStatus.setAttribute("role", "status");
    const copy = node("button", "copy-action", "Copy receipt ID");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(entry.receiptId);
        copyStatus.textContent = "Copied";
      } catch {
        copyStatus.textContent = "Copy unavailable";
      }
    });
    receipt.append(receiptId, copy, copyStatus);
    const action = node("td");
    action.dataset.label = "Action";
    const replay = node("button", "replay-action", "Replay fixture");
    replay.type = "button";
    replay.dataset.replayProfile = entry.profileId;
    replay.addEventListener("click", () => {
      selectProfile(entry.profileId, "verified-fixture");
      document.querySelector("#investigation").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    action.append(replay);
    row.append(protocol, event, block, disposition, checks, receipt, action);
    elements.archiveBody.append(row);
  }
}

function renderCaseSummary(detail, source) {
  const profile = getArchiveProfile(detail.alert.targetId ?? detail.profile?.id);
  const investigation = detail.evidence.upgradeInvestigation;
  const receipt = detail.evidence.investigationReceipt;
  const passed = investigation.checks.filter(({ status }) => status === "passed").length;
  elements.caseProfileId.textContent = profile.id;
  elements.caseProtocol.textContent = profile.displayName;
  elements.caseTarget.textContent = `${profile.targetName} · Base mainnet`;
  elements.caseEvent.textContent = detail.evidence.event.signature;
  elements.casePlan.textContent = `${investigation.plan.id} · v${investigation.plan.version}`;
  elements.caseStatus.textContent = investigation.evidenceStatus;
  elements.caseDisposition.textContent = investigation.disposition;
  elements.caseChecks.textContent = `${passed} of ${investigation.checks.length} passed`;
  elements.caseReceipt.textContent = receipt?.receiptId ?? "Not issued";
  elements.caseReceipt.title = receipt?.receiptId ?? "";
  elements.caseJourney.textContent = summarizeTraceProgression(buildInvestigationTrace(detail));
  const activeProfile = getArchiveProfile(state.activeProfileId);
  const isLiveProfile = profile.id === state.activeProfileId;
  elements.activeProfileNote.textContent = isLiveProfile
    ? `Live scanning is limited to ${profile.displayName}. A bounded historical scan is available.`
    : `Verified fixture replay only. Live scanning is currently limited to ${activeProfile.displayName}.`;
  setSourceBadge(detail, source);
}

function evidenceItem(row) {
  const wrapper = node("div", "evidence-item");
  wrapper.append(node("dt", "", row.label));
  const description = node("dd");
  description.append(row.link ? sourceLink(row.value, row.link) : document.createTextNode(row.value));
  wrapper.append(description);
  return wrapper;
}

function overviewItem(label, value, href) {
  const item = node("div", "overview-item");
  item.append(node("dt", "", label));
  const content = node("dd");
  const displayValue = value ?? "Unavailable";
  content.append(href ? sourceLink(String(displayValue), href) : document.createTextNode(String(displayValue)));
  item.append(content);
  return item;
}

function renderInvestigationOverview(detail, source) {
  const { alert, evidence } = detail;
  const investigation = evidence.upgradeInvestigation;
  const profile = detail.profile ?? getArchiveProfile(alert.targetId);
  const trace = buildInvestigationTrace(detail);
  const receipt = evidence.investigationReceipt;
  const limitations = alert.investigation?.limitations ?? receipt?.limitations ?? [];
  const section = node("section", "investigation-overview");
  const heading = node("div", "content-heading");
  heading.append(node("p", "kicker", "Investigation summary"), node("h3", "", "At a glance"));
  const grid = node("dl", "overview-grid");
  grid.append(
    overviewItem("Profile", profile?.displayName ?? alert.targetId ?? "Unavailable"),
    overviewItem("Chain", evidence.network ? `${evidence.network.name} · chain ${evidence.network.chainId}` : "Unavailable"),
    overviewItem("Trigger block", evidence.block?.number, evidence.sources?.block),
    overviewItem("Transaction", evidence.transaction?.hash, evidence.sources?.transaction),
    overviewItem("Block timestamp", formatUtcTimestamp(evidence.block?.timestamp)),
    overviewItem("Stages completed", summarizeTraceProgression(trace)),
    overviewItem("Disposition", investigation.disposition ?? "Not issued"),
    overviewItem("Limitations", limitations.length > 0 ? `${limitations.length} recorded below` : "None recorded"),
    overviewItem("Receipt", receipt?.receiptId ?? "Not issued"),
  );
  section.append(heading, grid);
  return section;
}

function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

function downloadReceipt(receipt) {
  downloadJson(`watchtower-${receipt.receiptId}.json`, receipt);
}

function downloadReviewPacket(detail, source) {
  const receipt = detail.evidence.investigationReceipt;
  if (!receipt) return;
  downloadJson(`watchtower-${receipt.receiptId}-review-packet.json`, {
    format: "watchtower-review-packet",
    source: source === "live" ? "live-rpc" : "verified-fixture",
    alert: detail.alert,
    evidence: detail.evidence,
    receipt,
  });
}

function receiptVerificationControl(receipt, detail, source) {
  const wrapper = node("div", "receipt-actions");
  const actionRow = node("div", "receipt-action-row");
  const result = node("p", "receipt-verification", "Verification has not been run in this browser.");
  result.setAttribute("role", "status");
  const packet = node("button", "secondary-action", "Download review packet");
  packet.type = "button";
  packet.addEventListener("click", () => downloadReviewPacket(detail, source));
  const button = node("button", "secondary-action", "Verify receipt");
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    result.className = "receipt-verification pending";
    result.textContent = "Recomputing the canonical receipt ID in this browser.";
    try {
      const verification = await verifyReceipt(receipt);
      result.className = `receipt-verification ${verification.verified ? "verified" : "failed"}`;
      result.textContent = verification.verified ? "Receipt verified" : "Receipt verification failed";
    } catch {
      result.className = "receipt-verification failed";
      result.textContent = "Receipt verification failed";
    } finally {
      button.disabled = false;
    }
  });
  actionRow.append(packet, button);
  wrapper.append(actionRow, result);
  return wrapper;
}

function traceResultLabel(status) {
  return {
    complete: "Verified",
    pending: "Pending",
    incomplete: "Incomplete",
    failed: "Failed",
  }[status] ?? status;
}

function appendTraceFact(container, label, value, href) {
  const group = node("div", "trace-fact");
  group.append(node("dt", "", label));
  const content = node("dd");
  const displayValue = value ?? "Unavailable";
  content.append(href ? sourceLink(String(displayValue), href) : document.createTextNode(String(displayValue)));
  group.append(content);
  container.append(group);
}

function stageEvidenceFields(stage, detail) {
  const { evidence } = detail;
  if (stage.id === "event-observed") {
    return [
      ["Event", evidence.event?.signature],
      ["Transaction", evidence.transaction?.hash, evidence.sources?.transaction],
      ["Block", evidence.block?.number, evidence.sources?.block],
      ["Log index", evidence.log?.index],
      ["Emitter", evidence.log?.emitter, evidence.sources?.addresses?.emitter],
      ["Implementation", evidence.event?.decodedArguments?.implementation, evidence.sources?.addresses?.implementation],
    ];
  }
  const receipt = evidence.investigationReceipt;
  if (stage.id === "receipt-issued" && receipt) {
    return [
      ["Receipt ID", receipt.receiptId],
      ["Disposition", receipt.finalDisposition],
      ["Limitations", `${receipt.limitations?.length ?? 0} recorded`],
    ];
  }
  return [];
}

function renderStageDetails(stage, detail, source) {
  const details = stage.details ?? [];
  const disclosure = node("details", "trace-disclosure");
  disclosure.open = stage.status !== "complete" || stage.index === 1;
  const summary = node("summary", "trace-disclosure-summary");
  const countLabel = details.length > 0
    ? `${details.length} recorded assertion${details.length === 1 ? "" : "s"}`
    : "Recorded evidence fields";
  summary.append(node("span", "trace-disclosure-label", "Stage details"), node("span", "trace-disclosure-count", countLabel));
  const content = node("div", "trace-disclosure-content");
  if (details.length > 0) {
    const detailList = node("ul", "trace-details");
    for (const check of details) {
      const row = node("li", "trace-detail");
      const detailTop = node("div", "trace-detail-top");
      detailTop.append(node("span", "trace-detail-label", check.label), badge(check.status));
      if (Number.isFinite(check.elapsedMs)) {
        detailTop.append(node("span", "trace-elapsed", `${check.elapsedMs} ms`));
      } else if (source === "verified-fixture") {
        detailTop.append(node("span", "trace-elapsed fixture-timing", "Timing not recorded for fixture replay"));
      }
      row.append(detailTop, node("p", "trace-detail-summary", check.summary));
      detailList.append(row);
    }
    content.append(detailList);
  } else {
    const fields = stageEvidenceFields(stage, detail);
    if (fields.length > 0) {
      const fieldList = node("dl", "trace-evidence-grid");
      for (const [label, value, href] of fields) appendTraceFact(fieldList, label, value, href);
      content.append(fieldList);
    } else {
      content.append(node("p", "trace-no-details", "No additional evidence was recorded for this stage."));
    }
  }
  disclosure.append(summary, content);
  return disclosure;
}

function renderTrace(detail, source) {
  const section = node("section", "trace-section");
  const heading = node("div", "content-heading");
  heading.append(node("p", "kicker", "Investigation trace"), node("h3", "", "Six stages of verification"));
  section.append(heading);
  const list = node("ol", "trace-list");
  for (const stage of buildInvestigationTrace(detail)) {
    const item = node("li", `trace-stage ${stage.status}`);
    item.dataset.stage = stage.id;
    item.dataset.status = stage.status;
    item.append(node("span", "trace-number", String(stage.index).padStart(2, "0")));
    const body = node("div", "trace-body");
    const top = node("div", "trace-top");
    const stageMeta = node("div", "trace-stage-meta");
    if (Number.isFinite(stage.elapsedMs)) stageMeta.append(node("span", "trace-elapsed", `${stage.elapsedMs} ms`));
    stageMeta.append(badge(stage.status));
    top.append(node("h4", "", stage.title), stageMeta);
    const stageFacts = node("dl", "trace-facts");
    appendTraceFact(stageFacts, "Source", source === "live" ? "Live RPC result" : "Verified fixture replay");
    appendTraceFact(stageFacts, "Timestamp", formatUtcTimestamp(detail.evidence.block?.timestamp));
    appendTraceFact(stageFacts, "Result", traceResultLabel(stage.status));
    appendTraceFact(stageFacts, "Block", detail.evidence.block?.number, detail.evidence.sources?.block);
    body.append(top, node("p", "trace-summary", stage.summary), stageFacts, renderStageDetails(stage, detail, source));
    if (stage.links.length > 0) {
      const links = node("div", "trace-links");
      links.setAttribute("aria-label", `${stage.title} evidence links`);
      for (const stageLink of stage.links) {
        if (stageLink.download && source === "verified-fixture") {
          const button = node("button", "trace-link", stageLink.label);
          button.type = "button";
          button.addEventListener("click", () => downloadReceipt(detail.evidence.investigationReceipt));
          links.append(button);
          continue;
        }
        const link = node("a", "trace-link", stageLink.label);
        link.href = stageLink.href;
        if (stageLink.external) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        if (stageLink.download) link.download = stageLink.download;
        links.append(link);
      }
      body.append(links);
    }
    item.append(body);
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderChecks(evidence) {
  const section = node("section", "ledger-section");
  const heading = node("div", "content-heading");
  heading.append(node("p", "kicker", "Assertion ledger"), node("h3", "", "Expected against observed"));
  section.append(heading);
  const ledger = node("div", "check-ledger");
  const investigation = evidence.upgradeInvestigation;
  const checks = [...(investigation.checks ?? [])];
  const recordedIds = new Set(checks.map(({ id }) => id));
  for (const id of investigation.plan?.skippedChecks ?? []) {
    if (recordedIds.has(id)) continue;
    checks.push({
      id,
      status: "skipped",
      method: "Not run",
      blockTag: "Not queried",
      assertion: {
        description: "The optional check was not authorized by the selected versioned plan.",
        expected: "Not required",
        actual: "Not run",
      },
      result: null,
      failure: null,
    });
  }
  for (const check of checks) {
    const article = node("article", `check-record ${check.status}`);
    const top = node("div", "check-record-top");
    top.append(node("h4", "", check.id), badge(check.status));
    const metadata = node("dl", "check-metadata");
    const fields = [
      ["RPC method", check.method],
      ["Block tag", check.blockTag],
      ["Expected", check.assertion.expected],
      ["Actual", check.assertion.actual ?? "Unavailable"],
      ...(check.result?.kind === "bytecode" ? [["Bytecode hash", check.result.hash ?? "Not recorded"]] : []),
    ];
    for (const [label, value] of fields) {
      const group = node("div");
      group.append(node("dt", "", label), node("dd", "", value));
      metadata.append(group);
    }
    article.append(top, node("p", "check-description", check.assertion?.description ?? "No assertion description was recorded."), metadata);
    if (check.failure) article.append(node("p", "check-failure", `${check.failure.code}: ${check.failure.message}`));
    ledger.append(article);
  }
  section.append(ledger);
  return section;
}

function renderSources(evidence) {
  const section = node("section", "sources-section");
  const heading = node("div", "content-heading");
  heading.append(node("p", "kicker", "Verifiable sources"), node("h3", "", "Open the underlying Base evidence"));
  section.append(heading);
  const links = node("div", "source-list");
  links.append(sourceLink("Transaction", evidence.sources.transaction, "source-record"));
  links.append(sourceLink("Block", evidence.sources.block, "source-record"));
  for (const [role, href] of Object.entries(evidence.sources.addresses)) {
    links.append(sourceLink(role.replaceAll("-", " "), href, "source-record"));
  }
  section.append(links);
  return section;
}

function renderDecision(detail) {
  const { alert, evidence } = detail;
  const investigation = evidence.upgradeInvestigation;
  const section = node("section", "decision-section");
  const heading = node("div", "content-heading");
  heading.append(node("p", "kicker", "Decision and limits"), node("h3", "", "What the evidence establishes"));
  const grid = node("div", "decision-grid");

  const disposition = node("article", "decision-block");
  const dispositionHeading = node("div", "decision-block-heading");
  dispositionHeading.append(node("p", "kicker", "Deterministic disposition"));
  const dispositionBadge = badge(investigation.disposition, `decision-badge ${investigation.disposition}`);
  dispositionBadge.setAttribute("role", "status");
  dispositionHeading.append(dispositionBadge);
  disposition.append(dispositionHeading);
  const interpretation = alert.investigation?.interpretation?.text;
  if (interpretation) disposition.append(node("p", "decision-explanation", interpretation));
  const incomplete = evidence.status === "incomplete"
    || investigation.evidenceStatus === "incomplete"
    || investigation.disposition === "incomplete";
  if (incomplete) {
    disposition.append(node("p", "decision-state-note", "No stronger conclusion is issued because required evidence is missing or incomplete."));
  }

  const facts = node("article", "context-block");
  facts.append(node("p", "kicker", "Observed facts"));
  const factList = node("ul");
  for (const fact of alert.investigation?.observedFacts ?? []) factList.append(node("li", "", fact));
  facts.append(factList);

  const limits = node("article", "context-block limitations");
  limits.append(node("p", "kicker", "Limitations"));
  const limitList = node("ul");
  for (const limitation of alert.investigation?.limitations ?? []) limitList.append(node("li", "", limitation));
  limits.append(limitList);

  grid.append(disposition, facts, limits);
  section.append(heading, grid);
  return section;
}

function renderDetail(detail, source) {
  const { alert, evidence } = detail;
  const investigation = evidence.upgradeInvestigation;
  elements.detail.replaceChildren();
  elements.detail.setAttribute("aria-busy", "false");
  const header = node("header", "detail-header");
  const title = node("div");
  const titleKicker = node("div", "detail-title-kicker");
  titleKicker.append(node("p", "kicker", alert.classificationLabel), createSourceBadge(investigationStateLabel(detail, source), "detail-source"));
  title.append(titleKicker, node("h3", "", alert.title), node("p", "detail-summary", alert.summary));
  const status = node("div", "badge-stack");
  status.append(
    node("p", "status-caption", "Deterministic disposition"),
    badge(investigation.disposition, `dominant-status-badge ${investigation.disposition}`),
    badge(alert.severity),
    badge(alert.evidenceStatus),
  );
  header.append(title, status);
  elements.detail.append(header, renderInvestigationOverview(detail, source), renderTrace(detail, source), renderChecks(evidence));

  if (evidence.errors.length > 0) {
    const errors = node("section", "evidence-errors");
    errors.append(node("p", "kicker danger", "Incomplete evidence"), node("h3", "", "Some required evidence could not be verified"));
    for (const error of evidence.errors) errors.append(node("p", "", `${error.code}: ${error.message}`));
    elements.detail.append(errors);
  }

  elements.detail.append(renderDecision(detail));

  const receipt = evidence.investigationReceipt;
  if (receipt) {
    const receiptBar = node("section", "receipt-bar");
    const copy = node("div");
    copy.append(node("p", "kicker", "Browser-verifiable receipt"), node("h3", "receipt-id", receipt.receiptId), node("p", "", "The review packet includes the alert, evidence, limitations, and canonical receipt. It documents what was checked and does not claim the upgrade is safe."));
    const actions = receiptVerificationControl(receipt, detail, source);
    const actionRow = actions.querySelector(".receipt-action-row");
    if (source === "live") {
      const link = node("a", "primary-action", "Download receipt JSON");
      link.href = `/api/receipts/${encodeURIComponent(receipt.receiptId)}`;
      link.download = `watchtower-${receipt.receiptId}.json`;
      actionRow.prepend(link);
    } else {
      const button = node("button", "primary-action", "Download receipt JSON");
      button.type = "button";
      button.addEventListener("click", () => downloadReceipt(receipt));
      actionRow.prepend(button);
    }
    receiptBar.append(copy, actions);
    elements.detail.append(receiptBar);
  }

  const evidenceSection = node("section", "evidence-section");
  const evidenceHeading = node("div", "content-heading");
  evidenceHeading.id = "evidence-record";
  evidenceHeading.append(node("p", "kicker", "Evidence record"), node("h3", "", "Trigger and chain metadata"));
  const grid = node("dl", "evidence-grid");
  for (const row of buildEvidenceRows(evidence, alert.classificationLabel)) grid.append(evidenceItem(row));
  evidenceSection.append(evidenceHeading, grid);
  elements.detail.append(evidenceSection, renderSources(evidence));
  renderCaseSummary(detail, source);
}

function showEmptyInvestigation(message, status = "incomplete", context = {}) {
  elements.detail.replaceChildren();
  elements.detail.setAttribute("aria-busy", "false");
  const state = status === "failed" ? "failed" : "incomplete";
  const empty = node("div", `detail-empty ${state}`);
  const summary = state === "failed"
    ? "The configured read-only investigation stopped before a complete evidence trace was available."
    : "No stronger disposition is issued until the required historical evidence is available.";
  const fields = state === "failed"
    ? [
        ["Failure category", context.category ?? "Configured scan failure"],
        ["Affected stage", context.stage ?? "Bounded historical scan"],
        ["Safe next action", context.nextAction ?? "Review the visible failure records and retry the configured scan."],
      ]
    : [
        ["Missing evidence", context.missing ?? "A complete alert, evidence record, or receipt was not returned."],
        ["Affected stage", context.stage ?? "Event and evidence collection"],
        ["Safe next action", context.nextAction ?? "Select a registered profile or rerun the bounded read-only scan."],
      ];
  const facts = node("dl", "detail-empty-facts");
  for (const [label, value] of fields) {
    const group = node("div");
    group.append(node("dt", "", label), node("dd", "", value));
    facts.append(group);
  }
  empty.append(
    node("p", "kicker", state === "failed" ? "Failed investigation" : "Incomplete investigation"),
    badge(state),
    node("h3", "", message),
    node("p", "detail-empty-copy", summary),
    facts,
  );
  elements.detail.append(empty);
}

function selectProfile(profileId, requestedSource) {
  const profile = getArchiveProfile(profileId);
  if (!profile) return;
  state.selectedProfileId = profile.id;
  renderProfiles();
  const liveDetail = state.liveDetails.get(profile.id);
  const source = requestedSource === "verified-fixture" || !liveDetail ? "verified-fixture" : "live";
  const detail = source === "live" ? liveDetail : buildFixtureDetail(profile);
  renderFailures(detail.scanFailures);
  renderDetail(detail, source);
  const activeProfile = getArchiveProfile(state.activeProfileId);
  const isLiveProfile = profile.id === state.activeProfileId;
  elements.scanButton.disabled = !isLiveProfile;
  elements.scanButton.textContent = isLiveProfile
    ? `Run configured ${profile.displayName} live scan`
    : `Live scan limited to ${activeProfile.displayName}`;
  elements.scanButton.title = isLiveProfile
    ? `Run the approved bounded historical scan for ${profile.displayName}.`
    : `This is a verified fixture replay. Live scanning is currently limited to ${activeProfile.displayName}.`;
  elements.scanStatus.textContent = source === "live"
    ? "Showing the latest in-memory live RPC result."
    : "Showing the committed verified fixture. Replay does not call the RPC.";
}

async function loadStoredLiveDetail() {
  const payload = await request("/api/alerts");
  const alert = payload.alerts.find(({ targetId }) => targetId === state.activeProfileId);
  if (!alert) return;
  const detail = await request(`/api/alerts/${encodeURIComponent(alert.id)}`);
  state.liveDetails.set(alert.targetId, { ...detail, source: "live" });
}

async function runScan() {
  if (state.selectedProfileId !== state.activeProfileId) return;
  elements.scanButton.disabled = true;
  elements.scanStatus.textContent = `Scanning approved Base block ${state.config.scan.fromBlock}.`;
  renderFailures([]);
  try {
    const result = await request("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    renderScanResult(result);
  } catch (error) {
    if (isStructuredScanResult(error.payload)) {
      renderScanResult(error.payload);
      return;
    }
    const failures = error.payload?.failures ?? [{ code: "request-failed", message: error.message }];
    renderFailures(failures);
    showEmptyInvestigation(error.message, "failed", {
      category: failures[0]?.code ?? "request-failed",
      stage: "Bounded live scan",
      nextAction: "Review the visible failure records and retry the configured scan.",
    });
    elements.scanStatus.textContent = error.message;
    elements.caseStatus.textContent = "failed";
    elements.caseDisposition.textContent = "not issued";
    elements.caseJourney.textContent = "Investigation failed";
    setSourceBadge({ scanStatus: "failed" }, "live");
  } finally {
    elements.scanButton.disabled = state.selectedProfileId !== state.activeProfileId;
  }
}

function renderScanResult(result) {
  renderFailures(result.failures);
  if (result.alerts.length === 0 || result.evidence.length === 0) {
    elements.scanStatus.textContent = `Scan ${result.status}. No complete alert is available. ${result.failures.length} failure records.`;
    const firstFailure = result.failures[0];
    showEmptyInvestigation("The live scan returned no investigation evidence.", result.status === "failed" ? "failed" : "incomplete", {
      category: firstFailure?.code ?? (result.status === "failed" ? "scan-failed" : "no-complete-evidence"),
      missing: "No complete alert and evidence record was returned.",
      stage: result.status === "failed" ? "Historical evidence retrieval" : "Event and evidence collection",
      nextAction: result.status === "failed"
        ? "Review the visible failure records and retry the configured scan."
        : "Review the missing evidence, then rerun the bounded read-only scan.",
    });
    elements.caseStatus.textContent = result.status;
    elements.caseDisposition.textContent = "not issued";
    elements.caseJourney.textContent = result.status === "failed"
      ? "Investigation failed"
      : "0 of 6 stages complete · investigation incomplete";
    elements.caseChecks.textContent = "0 passed";
    elements.caseReceipt.textContent = "Not issued";
    setSourceBadge({ scanStatus: result.status }, "live");
    return;
  }
  const detail = { alert: result.alerts[0], evidence: result.evidence[0], scanFailures: result.failures, scanStatus: result.status, source: "live" };
  state.liveDetails.set(result.targetId, detail);
  renderDetail(detail, "live");
  elements.scanStatus.textContent = `Live scan ${result.status}. ${result.alerts.length} alert and ${result.failures.length} failures.`;
}

async function updateHealth() {
  try {
    const health = await fetchHealth(request);
    if (health.status !== "ok") throw new Error("Health check failed.");
    elements.healthLabel.textContent = "System available";
    elements.healthDot.className = "health-dot healthy";
  } catch {
    elements.healthLabel.textContent = "System unavailable";
    elements.healthDot.className = "health-dot unhealthy";
  }
}

async function initialize() {
  elements.scanButton.addEventListener("click", runScan);
  renderArchive();
  await updateHealth();
  try {
    state.config = await request("/api/config");
    state.activeProfileId = state.config.profile.id;
    state.selectedProfileId = state.activeProfileId;
    if (!getArchiveProfile(state.activeProfileId)) throw new Error("The active server profile is outside the verified frontend registry.");
    try {
      await loadStoredLiveDetail();
    } catch {
      state.liveDetails.clear();
    }
    selectProfile(state.activeProfileId);
  } catch (error) {
    renderProfiles();
    showEmptyInvestigation(`Dashboard initialization failed: ${error.message}`, "failed", {
      category: "dashboard-initialization",
      stage: "Profile loading",
      nextAction: "Refresh the configured dashboard after the local server is available.",
    });
    elements.scanStatus.textContent = `Dashboard initialization failed: ${error.message}`;
    setSourceBadge({ scanStatus: "failed" }, "live");
  }
}

initializeTheme();
initializeFaq();
initialize();
