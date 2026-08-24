import type { Alert, Evidence, InvestigationReceipt, ScanFailure, ScanResult } from "../domain/schemas.js";

export type StoredAlertDetail = {
  alert: Alert;
  evidence: Evidence;
  scanFailures: ScanFailure[];
};

export class ScanStore {
  readonly #scans = new Map<string, ScanResult>();
  readonly #alerts = new Map<string, Alert>();
  readonly #evidence = new Map<string, Evidence>();
  readonly #receipts = new Map<string, InvestigationReceipt>();

  save(result: ScanResult): void {
    const previous = this.#scans.get(result.scanId);
    if (previous) {
      for (const alert of previous.alerts) this.#alerts.delete(alert.id);
      for (const evidence of previous.evidence) {
        this.#evidence.delete(evidence.id);
        if (evidence.investigationReceipt) this.#receipts.delete(evidence.investigationReceipt.receiptId);
      }
    }
    this.#scans.set(result.scanId, result);
    for (const evidence of result.evidence) {
      this.#evidence.set(evidence.id, evidence);
      if (evidence.investigationReceipt) this.#receipts.set(evidence.investigationReceipt.receiptId, evidence.investigationReceipt);
    }
    for (const alert of result.alerts) this.#alerts.set(alert.id, alert);
  }

  getScan(scanId: string): ScanResult | undefined {
    return this.#scans.get(scanId);
  }

  listAlerts(): Alert[] {
    return [...this.#alerts.values()].sort((left, right) => {
      if (left.observedAt === right.observedAt) return left.id.localeCompare(right.id);
      if (left.observedAt === null) return 1;
      if (right.observedAt === null) return -1;
      return right.observedAt.localeCompare(left.observedAt);
    });
  }

  getAlert(alertId: string): StoredAlertDetail | undefined {
    const alert = this.#alerts.get(alertId);
    if (!alert) return undefined;
    const evidence = this.#evidence.get(alert.evidenceId);
    const scan = this.#scans.get(alert.scanId);
    if (!evidence || !scan) return undefined;
    return { alert, evidence, scanFailures: scan.failures };
  }

  getReceipt(receiptId: string): InvestigationReceipt | undefined {
    return this.#receipts.get(receiptId);
  }
}
