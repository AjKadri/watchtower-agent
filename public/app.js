const elements = {
  alertCount: document.querySelector("#alert-count"),
  alertList: document.querySelector("#alert-list"),
  detail: document.querySelector("#detail-panel"),
  eventLabel: document.querySelector("#event-label"),
  failureList: document.querySelector("#failure-list"),
  failurePanel: document.querySelector("#failure-panel"),
  networkLabel: document.querySelector("#network-label"),
  rangeLabel: document.querySelector("#range-label"),
  scanButton: document.querySelector("#scan-button"),
  scanStatus: document.querySelector("#scan-status"),
  targetLabel: document.querySelector("#target-label"),
};

const state = { alerts: [], selectedAlertId: null };

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
    meta.append(node("span", "", alert.observedAt ? new Date(alert.observedAt).toLocaleString() : "Time unavailable"));
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
  heading.append(node("h2", "", alert.title));
  heading.append(node("p", "detail-summary", alert.summary));
  const badgeStack = node("div", "badge-stack");
  badgeStack.append(badge(alert.severity, alert.severity), badge(alert.evidenceStatus, alert.evidenceStatus));
  header.append(heading, badgeStack);
  elements.detail.append(header);

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

  elements.detail.append(node("p", "eyebrow evidence-title", "Evidence record"));
  const grid = node("dl", "evidence-grid");
  const implementation = evidence.event.decodedArguments.implementation ?? "Unavailable";
  grid.append(
    evidenceItem("Severity rule", evidence.severity.ruleId),
    evidenceItem("Evidence status", evidence.status),
    evidenceItem("Transaction", shortHash(evidence.transaction.hash), evidence.sources.transaction),
    evidenceItem("Receipt", evidence.transaction.receiptStatus ?? "Unavailable"),
    evidenceItem("Block number", evidence.block.number, evidence.sources.block),
    evidenceItem("Block hash", shortHash(evidence.block.hash), evidence.sources.block),
    evidenceItem("Block timestamp", evidence.block.timestamp ? new Date(evidence.block.timestamp).toLocaleString() : "Unavailable"),
    evidenceItem("Log index", evidence.log.index),
    evidenceItem("Emitter", shortHash(evidence.log.emitter), evidence.sources.addresses.emitter),
    evidenceItem("Implementation", shortHash(implementation), evidence.sources.addresses.implementation),
    evidenceItem("Event signature", evidence.event.signature),
    evidenceItem("Chain", `${evidence.network.name} · ${evidence.network.chainId}`),
  );
  elements.detail.append(grid);

  if (evidence.errors.length > 0) {
    const errors = node("section", "evidence-errors");
    errors.append(node("h3", "", "Incomplete evidence"));
    const list = node("ul");
    for (const error of evidence.errors) list.append(node("li", "", `${error.code}: ${error.message}`));
    errors.append(list);
    elements.detail.append(errors);
  }
}

async function selectAlert(alertId) {
  state.selectedAlertId = alertId;
  renderAlertList();
  elements.detail.setAttribute("aria-busy", "true");
  try {
    const detail = await request(`/api/alerts/${encodeURIComponent(alertId)}`);
    renderDetail(detail);
    renderFailures(detail.scanFailures);
  } catch (error) {
    elements.detail.replaceChildren(node("p", "detail-summary", error.message));
  } finally {
    elements.detail.removeAttribute("aria-busy");
  }
}

async function refreshAlerts(selectFirst = false) {
  const payload = await request("/api/alerts");
  state.alerts = payload.alerts;
  renderAlertList();
  if (selectFirst && state.alerts[0]) await selectAlert(state.alerts[0].id);
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
  try {
    const config = await request("/api/config");
    elements.networkLabel.textContent = `${config.network.name} · ${config.network.chainId}`;
    elements.targetLabel.textContent = config.target.name;
    elements.rangeLabel.textContent = `${config.scan.fromBlock} → ${config.scan.toBlock}`;
    elements.eventLabel.textContent = config.detector.eventSignature;
    await refreshAlerts(true);
  } catch (error) {
    elements.scanStatus.textContent = `Dashboard initialization failed: ${error.message}`;
  }
}

initialize();
