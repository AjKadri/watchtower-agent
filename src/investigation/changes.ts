import type { ScanResult } from "../domain/schemas.js";

export type ScanChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  previous: unknown;
  current: unknown;
};

export type ScanComparison = {
  baselineScanId: string;
  currentScanId: string;
  changed: boolean;
  changes: ScanChange[];
};

const MAX_CHANGES = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareValues(previous: unknown, current: unknown, path: string, changes: ScanChange[]): void {
  if (changes.length >= MAX_CHANGES) return;
  if (Object.is(previous, current)) return;

  if (isRecord(previous) && isRecord(current)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(current)].sort());
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in previous)) {
        changes.push({ path: childPath, kind: "added", previous: null, current: current[key] });
      } else if (!(key in current)) {
        changes.push({ path: childPath, kind: "removed", previous: previous[key], current: null });
      } else {
        compareValues(previous[key], current[key], childPath, changes);
      }
      if (changes.length >= MAX_CHANGES) return;
    }
    return;
  }

  if (Array.isArray(previous) && Array.isArray(current)) {
    const length = Math.max(previous.length, current.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}[${index}]`;
      if (index >= previous.length) {
        changes.push({ path: childPath, kind: "added", previous: null, current: current[index] });
      } else if (index >= current.length) {
        changes.push({ path: childPath, kind: "removed", previous: previous[index], current: null });
      } else {
        compareValues(previous[index], current[index], childPath, changes);
      }
      if (changes.length >= MAX_CHANGES) return;
    }
    return;
  }

  changes.push({ path, kind: "changed", previous, current });
}

export function compareScanResults(baseline: ScanResult, current: ScanResult): ScanComparison {
  const changes: ScanChange[] = [];
  compareValues(
    { status: baseline.status, alerts: baseline.alerts, evidence: baseline.evidence, failures: baseline.failures },
    { status: current.status, alerts: current.alerts, evidence: current.evidence, failures: current.failures },
    "",
    changes,
  );
  return {
    baselineScanId: baseline.scanId,
    currentScanId: current.scanId,
    changed: changes.length > 0,
    changes,
  };
}
