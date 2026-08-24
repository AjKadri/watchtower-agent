import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { targetProfileSelectionSchema, type TargetConfig } from "./schema.js";
import { validateUpgradeEventAbi } from "../events/upgrade.js";
import { resolveTargetProfile } from "../profiles/registry.js";

const runtimeEnvironmentSchema = z.object({
  BASE_RPC_URL: z.url().refine((url) => url.startsWith("https://") || url.startsWith("http://"), "must be an HTTP URL"),
  WATCHTOWER_CONFIG_PATH: z.string().min(1).default("config/target.json"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export type RuntimeConfig = {
  rpcUrl: string;
  port: number;
  target: TargetConfig;
};

export async function loadTargetConfig(path = "config/target.json"): Promise<TargetConfig> {
  const contents = await readFile(resolve(path), "utf8");
  const selection = targetProfileSelectionSchema.parse(JSON.parse(contents));
  const config = resolveTargetProfile(selection);
  const detector = config.detectors[0];
  const abiContents = await readFile(resolve(detector.abiFile), "utf8");
  validateUpgradeEventAbi(JSON.parse(abiContents), detector.topic0);
  return config;
}

export async function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): Promise<RuntimeConfig> {
  const parsed = runtimeEnvironmentSchema.parse(environment);
  return {
    rpcUrl: parsed.BASE_RPC_URL,
    port: parsed.PORT,
    target: await loadTargetConfig(parsed.WATCHTOWER_CONFIG_PATH),
  };
}
