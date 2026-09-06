import { describe, expect, it, vi } from "vitest";

import { archiveProfiles } from "../public/archive-data.js";
import { buildFixtureDetail } from "../public/view-model.js";
import { verifyReceipt } from "../public/receipt-verifier.js";
import {
  buildReviewPacket,
  serializeReviewPacketJson,
} from "../public/review-packet.js";
import {
  REVIEW_PACKET_VERIFICATION_STATUS,
  verifyReviewPacketText,
} from "../public/review-packet-verifier.js";

async function packetFor(profile) {
  const detail = buildFixtureDetail(profile);
  const verification = await verifyReceipt(profile.receipt);
  return buildReviewPacket(detail, {
    source: detail.source,
    profile,
    browserVerification: { ...verification, performed: true },
  });
}

describe("browser review packet verification", () => {
  it("verifies the exported JSON packet for every committed fixture", async () => {
    for (const profile of archiveProfiles) {
      const result = await verifyReviewPacketText(serializeReviewPacketJson(await packetFor(profile)));

      expect(result).toMatchObject({
        status: REVIEW_PACKET_VERIFICATION_STATUS.VALID,
        verified: true,
        receiptIdentifier: profile.receipt.receiptId,
        canonicalReceiptId: profile.receipt.receiptId,
        computedReceiptId: profile.receipt.receiptId,
      });
      expect(result.message).toContain("Canonical receipt verified");
      expect(result.message).toContain("Unhashed packet fields are not covered");
    }
  });

  it("detects a changed canonical receipt even when saved verification says verified", async () => {
    const packet = await packetFor(archiveProfiles[0]);
    packet.receipt.canonical.trigger.block.number = "1";
    packet.browserVerification = {
      performed: true,
      status: "verified",
      verified: true,
      computedReceiptId: packet.receipt.identifier,
    };

    const result = await verifyReviewPacketText(JSON.stringify(packet));

    expect(result).toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.TAMPERED,
      verified: false,
      receiptIdentifier: packet.receipt.identifier,
      canonicalReceiptId: packet.receipt.canonical.receiptId,
    });
    expect(result.computedReceiptId).not.toBe(packet.receipt.identifier);
  });

  it("ignores forged saved verification metadata when the canonical receipt is valid", async () => {
    const packet = await packetFor(archiveProfiles[1]);
    packet.browserVerification = {
      performed: false,
      status: "tampered",
      verified: false,
      computedReceiptId: `receipt_${"0".repeat(64)}`,
    };

    const result = await verifyReviewPacketText(JSON.stringify(packet));

    expect(result.status).toBe(REVIEW_PACKET_VERIFICATION_STATUS.VALID);
    expect(result.verified).toBe(true);
    expect(result.computedReceiptId).toBe(packet.receipt.identifier);
  });

  it("reports malformed JSON and malformed packet structures clearly", async () => {
    await expect(verifyReviewPacketText("{not-json")).resolves.toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.MALFORMED,
      verified: false,
    });
    await expect(verifyReviewPacketText(JSON.stringify([]))).resolves.toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.MALFORMED,
      verified: false,
    });
  });

  it("rejects a wrong format and unsupported packet schema", async () => {
    const packet = await packetFor(archiveProfiles[2]);
    const wrongFormat = { ...packet, format: "other-packet" };
    const unsupportedSchema = { ...packet, schemaVersion: 99 };

    await expect(verifyReviewPacketText(JSON.stringify(wrongFormat))).resolves.toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.WRONG_FORMAT,
      verified: false,
    });
    await expect(verifyReviewPacketText(JSON.stringify(unsupportedSchema))).resolves.toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.UNSUPPORTED_SCHEMA,
      verified: false,
    });
  });

  it("reports missing receipts and mismatched packet identifiers", async () => {
    const packet = await packetFor(archiveProfiles[0]);
    const withoutReceipt = { ...packet };
    delete withoutReceipt.receipt;
    const mismatched = structuredClone(packet);
    mismatched.receipt.identifier = `receipt_${"1".repeat(64)}`;

    await expect(verifyReviewPacketText(JSON.stringify(withoutReceipt))).resolves.toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.MISSING_RECEIPT,
      verified: false,
    });
    await expect(verifyReviewPacketText(JSON.stringify(mismatched))).resolves.toMatchObject({
      status: REVIEW_PACKET_VERIFICATION_STATUS.MISMATCHED_IDENTIFIERS,
      verified: false,
      receiptIdentifier: mismatched.receipt.identifier,
      canonicalReceiptId: packet.receipt.canonical.receiptId,
    });
  });

  it("performs verification without network requests or RPC access", async () => {
    const packet = await packetFor(archiveProfiles[1]);
    const fetchSpy = vi.fn(() => {
      throw new Error("network access is not allowed during packet verification");
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const result = await verifyReviewPacketText(serializeReviewPacketJson(packet));
      expect(result.status).toBe(REVIEW_PACKET_VERIFICATION_STATUS.VALID);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
