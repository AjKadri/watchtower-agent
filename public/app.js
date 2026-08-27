import { archiveProfiles, getArchiveProfile } from "/archive-data.js";
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

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function shortHash(value) {
  if (!value || value.length < 22) return value ?? "Unavailable";
  return `${value.slice(0, 11)}…${value.slice(-8)}`;
}

function badge(label, variant = label) {
  return node("span", `badge ${variant}`, label);
}

function sourceLink(label, href, className = "source-link") {
  const link = node("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
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
  const variant = label === "Live RPC investigation"
    ? "live"
    : label === "Verified fixture replay"
      ? "fixture"
      : label === "Failed investigation"
        ? "failed"
        : "incomplete";
  elements.sourceBadge.textContent = label;
  elements.sourceBadge.className = `source-badge ${variant}`;
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
  elements.activeProfileNote.textContent = profile.id === state.activeProfileId
    ? "This is the server-active profile. A live bounded scan is available."
    : `Archive view only. Live scanning remains fixed to ${getArchiveProfile(state.activeProfileId).displayName}.`;
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

function downloadReceipt(receipt) {
  const blob = new Blob([`${JSON.stringify(receipt, null, 2)}\n`], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `watchtower-${receipt.receiptId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

function receiptVerificationControl(receipt) {
  const wrapper = node("div", "receipt-actions");
  const result = node("p", "receipt-verification", "Verification has not been run in this browser.");
  result.setAttribute("role", "status");
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
  wrapper.append(button, result);
  return wrapper;
}

function renderTrace(detail, source) {
  const section = node("section", "trace-section");
  const heading = node("div", "content-heading");
  heading.append(node("p", "kicker", "Investigation trace"), node("h3", "", "Six stages of verification"));
  section.append(heading);
  const list = node("ol", "trace-list");
  for (const stage of buildInvestigationTrace(detail)) {
    const item = node("li", `trace-stage ${stage.status}`);
    item.append(node("span", "trace-number", String(stage.index).padStart(2, "0")));
    const body = node("div", "trace-body");
    const top = node("div", "trace-top");
    const stageMeta = node("div", "trace-stage-meta");
    if (Number.isFinite(stage.elapsedMs)) stageMeta.append(node("span", "trace-elapsed", `${stage.elapsedMs} ms`));
    stageMeta.append(badge(stage.status));
    top.append(node("h4", "", stage.title), stageMeta);
    body.append(top, node("p", "", stage.summary));
    if (stage.details.length > 0) {
      const detailList = node("ul", "trace-details");
      for (const check of stage.details) {
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
      body.append(detailList);
    }
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
  for (const check of evidence.upgradeInvestigation.checks) {
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
    article.append(top, node("p", "check-description", check.assertion.description), metadata);
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

function renderDetail(detail, source) {
  const { alert, evidence } = detail;
  elements.detail.replaceChildren();
  const header = node("header", "detail-header");
  const title = node("div");
  title.append(node("p", "kicker", alert.classificationLabel), node("h3", "", alert.title), node("p", "detail-summary", alert.summary));
  const status = node("div", "badge-stack");
  status.append(badge(alert.severity), badge(alert.evidenceStatus));
  header.append(title, status);
  elements.detail.append(header, renderTrace(detail, source), renderChecks(evidence));

  const context = node("section", "context-section");
  const facts = node("article", "context-block");
  facts.append(node("p", "kicker", "Observed facts"));
  const factList = node("ul");
  for (const fact of alert.investigation.observedFacts) factList.append(node("li", "", fact));
  facts.append(factList);
  const limits = node("article", "context-block limitations");
  limits.append(node("p", "kicker", "Limits"));
  const limitList = node("ul");
  for (const limitation of alert.investigation.limitations) limitList.append(node("li", "", limitation));
  limits.append(limitList);
  context.append(facts, limits);
  elements.detail.append(context);

  const evidenceSection = node("section", "evidence-section");
  const evidenceHeading = node("div", "content-heading");
  evidenceHeading.id = "evidence-record";
  evidenceHeading.append(node("p", "kicker", "Evidence record"), node("h3", "", "Trigger and chain metadata"));
  const grid = node("dl", "evidence-grid");
  for (const row of buildEvidenceRows(evidence, alert.classificationLabel)) grid.append(evidenceItem(row));
  evidenceSection.append(evidenceHeading, grid);
  elements.detail.append(evidenceSection, renderSources(evidence));

  if (evidence.errors.length > 0) {
    const errors = node("section", "evidence-errors");
    errors.append(node("h3", "", "Incomplete evidence"));
    for (const error of evidence.errors) errors.append(node("p", "", `${error.code}: ${error.message}`));
    elements.detail.append(errors);
  }

  const receipt = evidence.investigationReceipt;
  if (receipt) {
    const receiptBar = node("section", "receipt-bar");
    const copy = node("div");
    copy.append(node("p", "kicker", "Replay receipt"), node("h3", "", shortHash(receipt.receiptId)), node("p", "", "Validated JSON binds the trigger, plan, checks, limitations, and final disposition."));
    const actions = receiptVerificationControl(receipt);
    if (source === "live") {
      const link = node("a", "primary-action", "Download receipt JSON");
      link.href = `/api/receipts/${encodeURIComponent(receipt.receiptId)}`;
      link.download = `watchtower-${receipt.receiptId}.json`;
      actions.prepend(link);
    } else {
      const button = node("button", "primary-action", "Download receipt JSON");
      button.type = "button";
      button.addEventListener("click", () => downloadReceipt(receipt));
      actions.prepend(button);
    }
    receiptBar.append(copy, actions);
    elements.detail.append(receiptBar);
  }
  renderCaseSummary(detail, source);
}

function showEmptyInvestigation(message, status = "incomplete") {
  elements.detail.replaceChildren();
  const empty = node("div", `detail-empty ${status}`);
  empty.append(node("p", "kicker", status === "failed" ? "Failed investigation" : "No evidence selected"), node("h3", "", message));
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
  elements.scanButton.disabled = profile.id !== state.activeProfileId;
  elements.scanButton.title = elements.scanButton.disabled ? "Live scanning is fixed to the server-active profile." : "Run the approved bounded historical scan.";
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
    showEmptyInvestigation(error.message, "failed");
    elements.scanStatus.textContent = error.message;
    elements.caseStatus.textContent = "failed";
    elements.caseDisposition.textContent = "not issued";
    setSourceBadge({ scanStatus: "failed" }, "live");
  } finally {
    elements.scanButton.disabled = state.selectedProfileId !== state.activeProfileId;
  }
}

function renderScanResult(result) {
  renderFailures(result.failures);
  if (result.alerts.length === 0 || result.evidence.length === 0) {
    elements.scanStatus.textContent = `Scan ${result.status}. No complete alert is available. ${result.failures.length} failure records.`;
    showEmptyInvestigation("The live scan returned no investigation evidence.", result.status === "failed" ? "failed" : "incomplete");
    elements.caseStatus.textContent = result.status;
    elements.caseDisposition.textContent = "not issued";
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
    showEmptyInvestigation(`Dashboard initialization failed: ${error.message}`, "failed");
    elements.scanStatus.textContent = `Dashboard initialization failed: ${error.message}`;
    setSourceBadge({ scanStatus: "failed" }, "live");
  }
}

initialize();
