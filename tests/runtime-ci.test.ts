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
      "Smoke test compiled portable integrity export and offline verification",
      "createPortableArtifact",
      "format=portable",
      "http://127.0.0.1:3140/",
      "content-disposition",
      "FIXTURE_ONLY",
      "artifact-id-mismatch",
      "portable compiled smoke assertions passed",
      "BASE_RPC_URL: http://127.0.0.1:18545",
      "spawn(process.execPath, [\"--env-file-if-exists=.env\", \"dist/server/main.js\"]",
      "Watchtower listening at http://localhost:3000",
      "setTimeout",
      "api/health",
      'child.kill("SIGTERM")',
      'probe.listen(port, "127.0.0.1"',
      "Compiled SIGTERM and port-release assertions passed.",
    ]) {
      expect(workflow).toContain(required);
    }
    expect(workflow).toContain("BASE_RPC_URL: http://127.0.0.1:18545");
    expect(workflow).not.toContain("npm run --silent scan");
    expect(workflow).not.toContain("example.invalid");
    expect(workflow).not.toContain("actions/checkout@v4");
    expect(workflow).not.toContain("actions/setup-node@v4");
    expect(workflow).not.toContain("npm start >");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("sleep 1");
    expect(workflow).not.toContain("for _ in {1..30}");
    expect(workflow.indexOf("Watchtower listening at http://localhost:3000")).toBeGreaterThan(-1);
    expect(workflow.indexOf("spawn(process.execPath")).toBeGreaterThan(workflow.indexOf("Watchtower listening at http://localhost:3000"));
    expect(workflow.indexOf('child.kill("SIGTERM")')).toBeGreaterThan(workflow.indexOf("api/health"));
    expect(workflow.indexOf('probe.listen(port, "127.0.0.1"')).toBeGreaterThan(workflow.indexOf('child.kill("SIGTERM")'));

  });
});
