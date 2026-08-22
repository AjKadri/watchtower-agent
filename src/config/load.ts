import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { targetConfigSchema, type TargetConfig } from "./schema.js";

const runtimeEnvironmentSchema = z.object({
  BASE_RPC_URL: z.url().refine((url) => url.startsWith("https://") || url.startsWith("http://"), "must be an HTTP URL"),
  WATCHTOWER_CONFIG_PATH: z.string().min(1).default("config/target.json"),
});

export type RuntimeConfig = {
  rpcUrl: string;
  target: TargetConfig;
};

export async function loadTargetConfig(path = "config/target.json"): Promise<TargetConfig> {
  const contents = await readFile(resolve(path), "utf8");
  return targetConfigSchema.parse(JSON.parse(contents));
}

export async function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): Promise<RuntimeConfig> {
  const parsed = runtimeEnvironmentSchema.parse(environment);
  return {
    rpcUrl: parsed.BASE_RPC_URL,
    target: await loadTargetConfig(parsed.WATCHTOWER_CONFIG_PATH),
  };
}
