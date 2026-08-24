import {
  buildEvidenceRows,
  buildInvestigationTrace,
  canRenderAlertDetail,
  fetchHealth,
  formatUtcTimestamp,
  reconcileAlertSelection,
} from "/view-model.js";

const elements = {
  alertCount: document.querySelector("#alert-count"),
  alertList: document.querySelector("#alert-list"),
  detail: document.querySelector("#detail-panel"),
  eventLabel: document.querySelector("#event-label"),
  failureList: document.querySelector("#failure-list"),
  failurePanel: document.querySelector("#failure-panel"),
  healthDot: document.querySelector("#health-dot"),
  healthLabel: document.querySelector("#health-label"),
  networkLabel: document.querySelector("#network-label"),
  rangeLabel: document.querySelector("#range-label"),
  scanButton: document.querySelector("#scan-button"),
  scanStatus: document.querySelector("#scan-status"),
  signatureLabel: document.querySelector("#signature-label"),
  targetLabel: document.querySelector("#target-label"),
};

const state = { alerts: [], selectedAlertId: null, detailAlertId: null };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function shortHash(value) {
  if (!value || value.length < 20) return value ?? "Unavailable";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function badge(label, variant) {
  return node("span", `badge ${variant}`, label);
}

function sourceLink(label, href) {
  const link = node("a", "source-link", label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function traceLink(linkDefinition) {
  const link = node("a", "trace-link", linkDefinition.label);
  link.href = linkDefinition.href;
  if (linkDefinition.external) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  if (linkDefinition.download) link.download = linkDefinition.download;
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

function renderAlertList() {
  elements.alertCount.textContent = String(state.alerts.length);
  elements.alertList.replaceChildren();
  if (state.alerts.length === 0) {
    const empty = node("div", "empty-state");
    empty.append(node("p", "", "No scan results in memory."));
    empty.append(node("span", "", "Run the approved historical scan to populate this list."));
    elements.alertList.append(empty);
    return;
  }

  for (const alert of state.alerts) {
    const button = node("button", `alert-card${state.selectedAlertId === alert.id ? " active" : ""}`);
    button.type = "button";
    button.dataset.alertId = alert.id;
    button.setAttribute("aria-pressed", String(state.selectedAlertId === alert.id));
    const top = node("div", "alert-card-top");
    top.append(badge(alert.severity, alert.severity));
    top.append(badge(alert.evidenceStatus, alert.evidenceStatus));
    button.append(top);
    button.append(node("h3", "", alert.title));
    const meta = node("div", "alert-meta");
    meta.append(node("span", "", formatUtcTimestamp(alert.observedAt)));
    meta.append(node("span", "", shortHash(alert.id)));
    button.append(meta);
    button.addEventListener("click", () => selectAlert(alert.id));
    elements.alertList.append(button);
  }
}

function evidenceItem(label, value, link) {
  const wrapper = node("div", "evidence-item");
  const term = node("dt", "", label);
  const description = node("dd");
  description.append(link ? sourceLink(value, link) : document.createTextNode(value));
  wrapper.append(term, description);
  return wrapper;
}

function renderDetail(detail) {
  const { alert, evidence } = detail;
  elements.detail.replaceChildren();

  const header = node("header", "detail-header");
  const heading = node("div");
  heading.append(node("p", "eyebrow", "Normalized alert"));
  heading.append(node("p", "classification-label", alert.classificationLabel));
  heading.append(node("h2", "", alert.title));
  heading.append(node("p", "detail-summary", alert.summary));
  const badgeStack = node("div", "badge-stack");
  badgeStack.append(badge(alert.severity, alert.severity), badge(alert.evidenceStatus, alert.evidenceStatus));
  header.append(heading, badgeStack);
  elements.detail.append(header);

  const trace = node("section", "trace-section");
  const traceHeading = node("div", "trace-heading");
  const traceHeadingText = node("div");
  traceHeadingText.append(node("p", "eyebrow", "Deterministic investigation"));
  traceHeadingText.append(node("h3", "", "Six-stage trace"));
  const plan = evidence.upgradeInvestigation?.plan;
  traceHeading.append(traceHeadingText);
  if (plan) traceHeading.append(node("span", "trace-version", `${plan.id} · v${plan.version}`));
  trace.append(traceHeading);

  const traceList = node("ol", "trace-list");
  for (const stage of buildInvestigationTrace(detail)) {
    const item = node("li", `trace-stage ${stage.status}`);
    const marker = node("span", "trace-index", String(stage.index).padStart(2, "0"));
    const body = node("div", "trace-body");
    const top = node("div", "trace-stage-top");
    top.append(node("h4", "", stage.title), badge(stage.status, stage.status));
    body.append(top, node("p", "trace-summary", stage.summary));
    if (stage.elapsedMs !== null) body.append(node("p", "trace-elapsed", `${stage.elapsedMs} ms`));

    if (stage.details.length > 0) {
      const details = node("ul", "trace-checks");
      for (const check of stage.details) {
        const checkItem = node("li", `trace-check ${check.status}`);
        const checkTop = node("div", "trace-check-top");
        checkTop.append(node("span", "trace-check-label", check.label), badge(check.status, check.status));
        checkItem.append(checkTop, node("p", "", check.summary));
        if (check.elapsedMs !== null) checkItem.append(node("span", "trace-elapsed", `${check.elapsedMs} ms`));
        details.append(checkItem);
      }
      body.append(details);
    }

    if (stage.links.length > 0) {
      const links = node("div", "trace-links");
      for (const link of stage.links) links.append(traceLink(link));
      body.append(links);
    }
    item.append(marker, body);
    traceList.append(item);
  }
  trace.append(traceList);
  elements.detail.append(trace);

  const investigation = node("section", "investigation-grid");
  const facts = node("div", "investigation-card");
  facts.append(node("h3", "", "Observed facts"));
  const factList = node("ul");
  for (const fact of alert.investigation.observedFacts) factList.append(node("li", "", fact));
  facts.append(factList);

  const interpretation = node("div", "investigation-card");
  interpretation.append(node("h3", "", "Interpretation"));
  interpretation.append(node("p", "", alert.investigation.interpretation.text));
  interpretation.append(node("p", "rule-line", `Rule · ${alert.investigation.interpretation.severityRuleId}`));

  const limits = node("div", "investigation-card full");
  limits.append(node("h3", "", "Limits of this evidence"));
  const limitList = node("ul");
  for (const limitation of alert.investigation.limitations) limitList.append(node("li", "", limitation));
  limits.append(limitList);
  investigation.append(facts, interpretation, limits);
  elements.detail.append(investigation);

  const evidenceTitle = node("p", "eyebrow evidence-title", "Evidence record");
  evidenceTitle.id = "evidence-record";
  elements.detail.append(evidenceTitle);
  const grid = node("dl", "evidence-grid");
  for (const row of buildEvidenceRows(evidence, alert.classificationLabel)) {
    grid.append(evidenceItem(row.label, row.value, row.link));
  }
  elements.detail.append(grid);

  if (evidence.errors.length > 0) {
    const errors = node("section", "evidence-errors");
    errors.append(node("h3", "", "Incomplete evidence"));
    const list = node("ul");
    for (const error of evidence.errors) list.append(node("li", "", `${error.code}: ${error.message}`));
    errors.append(list);
    elements.detail.append(errors);
  }
  state.detailAlertId = alert.id;
}

async function selectAlert(alertId) {
  state.selectedAlertId = alertId;
  renderAlertList();
  if (state.detailAlertId !== alertId) {
    elements.detail.replaceChildren(node("p", "detail-summary", "Loading current alert evidence…"));
  }
  elements.detail.setAttribute("aria-busy", "true");
  try {
    const detail = await request(`/api/alerts/${encodeURIComponent(alertId)}`);
    if (!canRenderAlertDetail(state.alerts, state.selectedAlertId, detail.alert.id)) return;
    renderDetail(detail);
    renderFailures(detail.scanFailures);
  } catch (error) {
    if (state.selectedAlertId === alertId) {
      state.detailAlertId = null;
      elements.detail.replaceChildren(node("p", "detail-summary", error.message));
    }
  } finally {
    elements.detail.removeAttribute("aria-busy");
  }
}

async function refreshAlerts(selectFirst = false) {
  const payload = await request("/api/alerts");
  const previousAlertId = state.selectedAlertId;
  state.alerts = payload.alerts;
  state.selectedAlertId = reconcileAlertSelection(state.alerts, previousAlertId, selectFirst);
  renderAlertList();
  if (!state.selectedAlertId) {
    state.detailAlertId = null;
    elements.detail.replaceChildren(node("p", "detail-summary", "No alert is selected. Run the approved scan or select a current alert."));
    return;
  }
  if (selectFirst || state.selectedAlertId !== previousAlertId) {
    state.detailAlertId = null;
    await selectAlert(state.selectedAlertId);
  }
}

async function updateHealth() {
  try {
    const health = await fetchHealth(request);
    if (health.status !== "ok") throw new Error("The health endpoint did not report ok.");
    elements.healthLabel.textContent = "API healthy";
    elements.healthDot.classList.remove("unhealthy");
  } catch {
    elements.healthLabel.textContent = "API unavailable";
    elements.healthDot.classList.add("unhealthy");
  }
}

async function runScan() {
  elements.scanButton.disabled = true;
  elements.scanStatus.textContent = "Scanning approved Base block 41105890…";
  renderFailures([]);
  try {
    const result = await request("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    elements.scanStatus.textContent = `Scan ${result.status}. ${result.alerts.length} alert, ${result.failures.length} failures.`;
    renderFailures(result.failures);
    await refreshAlerts(true);
  } catch (error) {
    elements.scanStatus.textContent = error.message;
    renderFailures(error.payload?.failures ?? [{ code: "request-failed", message: error.message }]);
  } finally {
    elements.scanButton.disabled = false;
  }
}

async function initialize() {
  elements.scanButton.addEventListener("click", runScan);
  await updateHealth();
  try {
    const config = await request("/api/config");
    elements.networkLabel.textContent = `${config.network.name} · ${config.network.chainId}`;
    elements.targetLabel.textContent = config.target.name;
    elements.rangeLabel.textContent = `${config.scan.fromBlock} → ${config.scan.toBlock}`;
    elements.eventLabel.textContent = config.detector.classificationLabel;
    elements.signatureLabel.textContent = config.detector.eventSignature;
    await refreshAlerts(true);
  } catch (error) {
    elements.scanStatus.textContent = `Dashboard initialization failed: ${error.message}`;
  }
}

initialize();
