import { createHash } from "node:crypto";

import { scanResultSchema, type ScanResult } from "../domain/schemas.js";
import { normalizeEvmAddresses } from "../evm/address.js";
import { stableSerialize } from "../pipeline/ids.js";

export const PORTABLE_INTEGRITY_FORMAT = "watchtower-portable-integrity" as const;
export const PORTABLE_INTEGRITY_VERSION = 1 as const;

export type PortableIntegritySource = {
  declared: "live" | "fixture";
  provenance: "live-rpc" | "verified-fixture";
};

export type PortableIntegrityArtifact = {
  format: typeof PORTABLE_INTEGRITY_FORMAT;
  artifactVersion: typeof PORTABLE_INTEGRITY_VERSION;
  artifactId: string;
  source: PortableIntegritySource;
  scanResult: ScanResult;
};

export function canonicalPortableIntegrityArtifact(
  artifact: Pick<PortableIntegrityArtifact, "format" | "artifactVersion" | "source" | "scanResult">,
): Omit<PortableIntegrityArtifact, "artifactId"> {
  return normalizeEvmAddresses({
    format: artifact.format,
    artifactVersion: artifact.artifactVersion,
    source: artifact.source,
    scanResult: artifact.scanResult,
  }) as Omit<PortableIntegrityArtifact, "artifactId">;
}

export function createPortableIntegrityArtifactId(
  artifact: Pick<PortableIntegrityArtifact, "format" | "artifactVersion" | "source" | "scanResult">,
): string {
  const digest = createHash("sha256")
    .update(stableSerialize(canonicalPortableIntegrityArtifact(artifact)))
    .digest("hex");
  return `artifact_${digest}`;
}

export function createPortableIntegrityArtifact(
  result: ScanResult,
  source: PortableIntegritySource,
): PortableIntegrityArtifact {
  const scanResult = scanResultSchema.parse(result);
  const payload = {
    format: PORTABLE_INTEGRITY_FORMAT,
    artifactVersion: PORTABLE_INTEGRITY_VERSION,
    source,
    scanResult,
  } as const;
  return {
    ...payload,
    artifactId: createPortableIntegrityArtifactId(payload),
  };
}
