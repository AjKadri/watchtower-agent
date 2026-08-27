import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { readJson } from "./helpers.js";

type PackageManifest = {
  packageManager: string;
  engines: Record<string, string>;
  scripts: Record<string, string>;
};

describe("release runtime and CI configuration", () => {
  it("pins Node 24 and returns a clear unsupported-runtime failure", () => {
    const manifest = readJson<PackageManifest>("../package.json", import.meta.url);
    const nvmrc = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8");
    const unsupported = spawnSync(process.execPath, [
      new URL("../scripts/check-runtime.mjs", import.meta.url).pathname,
      "23.11.0",
    ], { encoding: "utf8" });

    expect(nvmrc.trim()).toBe("24");
    expect(manifest.packageManager).toBe("npm@11.12.1");
    expect(manifest.engines).toEqual({ node: "24.x", npm: "11.x" });
    expect(manifest.scripts.preinstall).toBe("node scripts/check-runtime.mjs");
    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr).toContain("Unsupported Node.js runtime 23.11.0");
    expect(unsupported.stderr).toContain("Watchtower requires Node.js 24.x");
  });

  it("runs the complete Node 24 release and production smoke checks", () => {
    const workflow = readFileSync(new URL("../.github/workflows/release-checks.yml", import.meta.url), "utf8");

    for (const required of [
      "actions/checkout@v5",
      "actions/setup-node@v5",
      "node-version-file: .nvmrc",
      "npm ci",
      "npm test",
      "npm run typecheck",
      "npm run build",
      "npm audit --audit-level=moderate",
      "npm ci --omit=dev",
      "node --env-file-if-exists=.env dist/server/main.js",
      "http://127.0.0.1:3000/api/health",
      "kill -TERM",
      'wait "$node_pid"',
      '"$node_status" -ne 0',
      'probe.listen(3000, "127.0.0.1"',
      '"$node_state" != Z*',
      'cat "$log_file"',
      "Health check passed with HTTP",
      "Compiled Node PID:",
      "Sending SIGTERM",
      "Compiled Node wait status:",
      "Port 3000 is free.",
      "Final compiled Node process state:",
    ]) {
      expect(workflow).toContain(required);
    }
    expect(workflow).toContain("BASE_RPC_URL: https://example.invalid");
    expect(workflow).not.toContain("actions/checkout@v4");
    expect(workflow).not.toContain("actions/setup-node@v4");
    expect(workflow).not.toContain("npm start >");
    expect(workflow).not.toContain("secrets.");

    const signalIndex = workflow.indexOf('kill -TERM "$node_pid"');
    const waitIndex = workflow.indexOf('wait "$node_pid"');
    const portProbeIndex = workflow.indexOf('probe.listen(3000, "127.0.0.1"');
    const processStateIndex = workflow.indexOf('Final compiled Node process state:');
    expect(signalIndex).toBeGreaterThan(-1);
    expect(waitIndex).toBeGreaterThan(signalIndex);
    expect(portProbeIndex).toBeGreaterThan(waitIndex);
    expect(processStateIndex).toBeGreaterThan(portProbeIndex);
  });
});
