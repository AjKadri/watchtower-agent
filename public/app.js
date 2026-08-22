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
  systemStatus: document.querySelector("#system-status"),
  targetAddress: document.querySelector("#target-address"),
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
  const link = node("a", "source-link");
  link.href = href;
  link.title = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${label}, open verifiable source`);
  link.append(node("span", "source-value", label), node("span", "source-action", "VERIFY SOURCE"));
  return link;
}

function setScanStatus(message, stateName) {
  elements.scanStatus.textContent = message;
  elements.scanStatus.dataset.state = stateName;
}

function setSystemStatus(message, stateName) {
  elements.systemStatus.lastChild.textContent = message;
  elements.systemStatus.dataset.state = stateName;
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
    empty.append(node("span", "empty-rule"));
    const message = node("div");
    message.append(node("p", "", "NO ALERTS IN SESSION"));
    message.append(node("small", "", "Run the approved historical scan to load deterministic evidence."));
    empty.append(message);
    elements.alertList.append(empty);
    return;
  }

  for (const alert of state.alerts) {
    const button = node("button", `alert-row${state.selectedAlertId === alert.id ? " active" : ""}`);
    button.type = "button";
    button.dataset.alertId = alert.id;
    button.setAttribute("aria-pressed", String(state.selectedAlertId === alert.id));
    button.append(
      node("span", "alert-cell severity-cell"),
      node("span", "alert-cell evidence-cell"),
      node("span", "alert-cell detection-cell", alert.title),
      node("span", "alert-cell observed-cell", alert.observedAt ? new Date(alert.observedAt).toLocaleString() : "Time unavailable"),
      node("span", "alert-cell id-cell", shortHash(alert.id)),
    );
    button.children[0].append(badge(alert.severity, alert.severity));
    button.children[1].append(badge(alert.evidenceStatus, alert.evidenceStatus));
    button.addEventListener("click", () => selectAlert(alert.id));
    elements.alertList.append(button);
  }
}

function evidenceItem(label, value, link) {
  const wrapper = node("div", "evidence-item");
  const term = node("dt", "", label);
  const description = node("dd");
  description.title = value;
  description.append(link ? sourceLink(value, link) : document.createTextNode(value));
  wrapper.append(term, description);
  return wrapper;
}

function signalCell(label, value) {
  const wrapper = node("div", "signal-cell");
  wrapper.append(node("dt", "", label), node("dd", "", value));
  return wrapper;
}

function eventNode(label, value, href) {
  const wrapper = node("div", "event-node");
  wrapper.append(node("span", "", label));
  const strong = node("strong");
  strong.append(href ? sourceLink(shortHash(value), href) : document.createTextNode(value));
  strong.title = value;
  wrapper.append(strong);
  return wrapper;
}

function renderDetail(detail) {
  const { alert, evidence } = detail;
  elements.detail.replaceChildren();

  const header = node("header", "detail-header");
  const heading = node("div");
  heading.append(node("p", "kicker", `ALERT RECORD / ${shortHash(alert.id)}`));
  const alertTitle = node("h2", "", alert.title);
  alertTitle.id = "detail-title";
  heading.append(alertTitle);
  heading.append(node("p", "detail-summary", alert.summary));
  const badgeStack = node("div", "badge-stack");
  badgeStack.append(badge(alert.severity, alert.severity), badge(alert.evidenceStatus, alert.evidenceStatus));
  header.append(heading, badgeStack);
  elements.detail.append(header);

  const signalStrip = node("dl", "signal-strip");
  signalStrip.append(
    signalCell("Severity rule", alert.severityRuleId),
    signalCell("Evidence state", alert.evidenceStatus.toUpperCase()),
    signalCell("Block", evidence.block.number),
    signalCell("Log index", evidence.log.index),
  );
  elements.detail.append(signalStrip);

  const implementation = evidence.event.decodedArguments.implementation ?? "Unavailable";
  const eventPath = node("section", "event-path");
  const edge = node("div", "event-edge");
  edge.append(node("span", "", "DECODED EVENT"), node("b", "", evidence.event.signature));
  eventPath.append(
    eventNode("EMITTING PROXY", evidence.log.emitter, evidence.sources.addresses.emitter),
    edge,
    eventNode("IMPLEMENTATION TARGET", implementation, evidence.sources.addresses.implementation),
  );
  elements.detail.append(eventPath);

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

  elements.detail.append(node("p", "evidence-title", "VERIFIABLE EVIDENCE SOURCES"));
  const grid = node("dl", "evidence-grid");
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
    const errorState = node("div", "detail-error");
    errorState.append(node("p", "kicker", "ALERT RETRIEVAL FAILED"));
    errorState.append(node("h2", "", "Investigation record unavailable"));
    errorState.append(node("p", "", error.message));
    elements.detail.replaceChildren(errorState);
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
  setScanStatus("RUNNING / QUERYING BLOCK 41105890", "running");
  renderFailures([]);
  try {
    const result = await request("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const alertLabel = result.alerts.length === 1 ? "ALERT" : "ALERTS";
    const failureLabel = result.failures.length === 1 ? "FAILURE" : "FAILURES";
    setScanStatus(`${result.status.toUpperCase()} / ${result.alerts.length} ${alertLabel} / ${result.failures.length} ${failureLabel}`, result.status === "complete" ? "complete" : "error");
    renderFailures(result.failures);
    await refreshAlerts(true);
  } catch (error) {
    setScanStatus(`FAILED / ${error.message}`, "error");
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
    elements.targetAddress.textContent = config.target.primaryContract.address;
    elements.rangeLabel.textContent = `${config.scan.fromBlock} → ${config.scan.toBlock}`;
    elements.eventLabel.textContent = config.detector.eventSignature;
    await refreshAlerts(true);
    setSystemStatus("SYSTEM READY", "ready");
  } catch (error) {
    setSystemStatus("SYSTEM DEGRADED", "error");
    setScanStatus(`INITIALIZATION FAILED / ${error.message}`, "error");
    renderFailures([{ code: "initialization-failed", message: error.message }]);
  }
}

initialize();
