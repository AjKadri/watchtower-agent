import { describe, expect, it } from "vitest";

import { archiveProfiles } from "../public/archive-data.js";
import {
  buildFixtureDetail,
} from "../public/view-model.js";
import { verifyReceipt } from "../public/receipt-verifier.js";
import {
  buildReviewPacket,
  formatReviewPacketMarkdown,
  reviewPacketFilename,
  REVIEW_PACKET_FORMAT,
  REVIEW_PACKET_SCHEMA_VERSION,
  serializeReviewPacketJson,
} from "../public/review-packet.js";

function verifiedPacket(detail, source = "verified-fixture") {
  return verifyReceipt(detail.evidence.investigationReceipt).then((verification) => buildReviewPacket(detail, {
    source,
    browserVerification: { ...verification, performed: true },
  }));
}

describe("review packet exports", () => {
  it("includes the complete evidence contract for every committed fixture", async () => {
    for (const profile of archiveProfiles) {
      const packet = await verifiedPacket(buildFixtureDetail(profile));

      expect(packet).toMatchObject({
        format: REVIEW_PACKET_FORMAT,
        schemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
        source: { type: "verified-fixture-replay", label: "Verified fixture replay" },
        profile: {
          id: profile.id,
          displayName: profile.displayName,
          protocol: profile.protocol,
          product: profile.product,
          targetName: profile.targetName,
          targetPurpose: profile.targetPurpose,
        },
        network: { name: "base-mainnet", chainId: 8453 },
        disposition: "corroborated",
        receipt: {
          identifier: profile.receipt.receiptId,
          schemaVersion: 1,
          canonical: profile.receipt,
        },
        browserVerification: {
          performed: true,
          status: "verified",
          verified: true,
          receiptId: profile.receipt.receiptId,
          expectedReceiptId: profile.receipt.receiptId,
          computedReceiptId: profile.receipt.receiptId,
        },
      });
      expect(packet.upgrade).toMatchObject({
        transaction: profile.transaction,
        block: profile.block,
        event: {
          signature: "Upgraded(address)",
          emitter: profile.emitter,
          logIndex: profile.logIndex,
          decodedImplementation: profile.implementation,
        },
      });
      expect(packet.addresses).toHaveLength(profile.addresses.length);
      expect(packet.addresses).toEqual(expect.arrayContaining(profile.addresses.map(({ key, address, role }) => ({ key, address, role }))));
      expect(packet.historicalProxyState.before).toMatchObject({ id: "implementation-before", method: "eth_getStorageAt" });
      expect(packet.historicalProxyState.atUpgrade).toMatchObject({ id: "implementation-at-upgrade", method: "eth_getStorageAt" });
      expect(packet.implementationBytecode).toMatchObject({ id: "implementation-bytecode", method: "eth_getCode" });
      expect(packet.checks).toHaveLength(profile.receipt.checks.length);
      for (const check of packet.checks) {
        expect(check).toEqual(expect.objectContaining({
          id: expect.any(String),
          method: expect.any(String),
          blockTag: expect.any(String),
          expected: expect.any(String),
          actual: expect.any(String),
          status: expect.any(String),
          failure: null,
        }));
      }
      expect(packet.protocolChecks).toHaveLength(profile.receipt.checks.length - 3);
      expect(packet.severity).toMatchObject({ level: "informational", deterministic: true });
      expect(packet.observedFacts.length).toBeGreaterThan(0);
      expect(packet.interpretation.text).toContain("approved implementation");
      expect(packet.limitations).toEqual(expect.arrayContaining(profile.receipt.limitations));
      expect(packet.explorerLinks).toEqual(profile.links);
      expect(packet.agentInvestigation).toMatchObject({ status: "not-run", steps: [], provider: null, model: null });
      expect(packet.receipt.canonical).not.toHaveProperty("agentInvestigation");
    }
  });

  it("keeps Markdown and JSON exports aligned on the same investigation facts", async () => {
    const profile = archiveProfiles[1];
    const detail = buildFixtureDetail(profile);
    const packet = await verifiedPacket(detail);
    const json = JSON.parse(serializeReviewPacketJson(packet));
    const markdown = formatReviewPacketMarkdown(packet);

    expect(json).toEqual(packet);
    for (const value of [
      packet.profile.displayName,
      packet.profile.id,
      packet.network.chainId,
      packet.upgrade.transaction.hash,
      packet.upgrade.block.number,
      packet.upgrade.event.signature,
      packet.upgrade.event.decodedImplementation,
      packet.receipt.identifier,
      packet.browserVerification.computedReceiptId,
    ]) {
      expect(markdown).toContain(String(value));
    }
    for (const check of packet.checks) {
      expect(markdown).toContain(check.id);
      expect(markdown).toContain(check.method);
      expect(markdown).toContain(check.blockTag);
      expect(markdown).toContain(check.expected);
      expect(markdown).toContain(check.actual);
      expect(markdown).toContain(check.status);
    }
    expect(markdown).toContain("Verified fixture replay");
    expect(markdown).toContain("## Limitations");
    expect(markdown).toContain("## Explorer links");
    expect(markdown).toContain(profile.links.transaction);
    expect(markdown).toContain(profile.links.block);
    expect(reviewPacketFilename(packet, "md")).toBe(`watchtower-${profile.receipt.receiptId}-review-packet.md`);
    expect(reviewPacketFilename(packet, "json")).toBe(`watchtower-${profile.receipt.receiptId}-review-packet.json`);
  });

  it("records a failed browser verification instead of claiming an altered receipt is valid", async () => {
    const profile = archiveProfiles[0];
    const detail = structuredClone(buildFixtureDetail(profile));
    detail.evidence.investigationReceipt.trigger.block.number = "1";
    const verification = await verifyReceipt(detail.evidence.investigationReceipt);
    const packet = buildReviewPacket(detail, {
      source: "verified-fixture",
      browserVerification: { ...verification, performed: true },
    });

    expect(verification.verified).toBe(false);
    expect(packet.browserVerification).toMatchObject({ performed: true, status: "failed", verified: false });
    expect(packet.browserVerification.computedReceiptId).not.toBe(packet.receipt.identifier);
    expect(formatReviewPacketMarkdown(packet)).toContain("Browser verification: `failed`");
  });

  it("distinguishes live RPC results from fixture replays", async () => {
    const detail = buildFixtureDetail(archiveProfiles[2]);
    const packet = await verifiedPacket(detail, "live");

    expect(packet.source).toEqual({ type: "live-rpc", label: "Live RPC result" });
    expect(formatReviewPacketMarkdown(packet)).toContain("Live RPC result");
  });

  it("keeps agent investigation data outside the canonical receipt payload", async () => {
    const detail = structuredClone(buildFixtureDetail(archiveProfiles[2]));
    detail.evidence.agentInvestigation = {
      status: "complete",
      provider: "openrouter",
      model: "bounded-test-model",
      steps: [{
        step: 1,
        requestedCheckId: "endpoint-at-upgrade",
        rationale: "Confirm the configured endpoint.",
        toolResultRef: "endpoint-at-upgrade",
        outcome: "passed",
      }],
      narrative: "The fixed endpoint check corroborated the profile.",
      uncertainty: "This does not establish remote safety.",
      failure: null,
    };
    const packet = await verifiedPacket(detail, "live");

    expect(packet.agentInvestigation).toMatchObject({ status: "complete", provider: "openrouter" });
    expect(packet.agentInvestigation.steps).toHaveLength(1);
    expect(packet.receipt.canonical).not.toHaveProperty("agentInvestigation");
    expect(packet.receipt.canonical).not.toHaveProperty("agent");
    expect(serializeReviewPacketJson(packet)).toContain('"agentInvestigation"');
    expect(formatReviewPacketMarkdown(packet)).toContain("endpoint-at-upgrade");
  });
});
