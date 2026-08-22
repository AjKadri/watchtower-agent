import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readJson<T>(relativeUrl: string, baseUrl: string): T {
  const path = fileURLToPath(new URL(relativeUrl, baseUrl));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
