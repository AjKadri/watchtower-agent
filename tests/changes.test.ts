import { describe, expect, it } from "vitest";

import { compareScanResults } from "../src/investigation/changes.js";
import type { ScanResult } from "../src/domain/schemas.js";
import { ScanStore } from "../src/server/store.js";

function scan(status: ScanResult["status"], alerts: unknown[] = []): ScanResult {
  return {
    scanId: "scan_" + "a".repeat(64),
    targetId: "aave-v3-base-core",
    range: { fromBlock: "1", toBlock: "2" },
    status,
    alerts: alerts as ScanResult["alerts"],
    evidence: [],
    failures: [],
  };
}

describe("scan change comparison", () => {
  it("reports no change for identical scan state", () => {
    const baseline = scan("complete");
    expect(compareScanResults(baseline, scan("complete"))).toMatchObject({ changed: false, changes: [] });
  });

  it("reports field-level status and alert changes", () => {
    const baseline = scan("complete", [{ id: "alert-1", severity: "informational" }]);
    const current = scan("partial", [{ id: "alert-1", severity: "high" }]);
    const comparison = compareScanResults(baseline, current);
    expect(comparison.changed).toBe(true);
    expect(comparison.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "status", kind: "changed", previous: "complete", current: "partial" }),
      expect.objectContaining({ path: "alerts[0].severity", kind: "changed", previous: "informational", current: "high" }),
    ]));
  });
});

describe("scan history", () => {
  it("keeps the previous result for incident comparison", () => {
    const store = new ScanStore();
    const first = scan("complete");
    const second = scan("partial");
    store.save(first);
    expect(store.getPreviousScan(first.scanId)).toBeUndefined();
    store.save(second);
    expect(store.getPreviousScan(first.scanId)).toEqual(first);
  });
});
