import { verifyReceipt } from "./receipt-verifier.js";
import { REVIEW_PACKET_FORMAT, REVIEW_PACKET_SCHEMA_VERSION } from "./review-packet.js";

export const REVIEW_PACKET_VERIFICATION_STATUS = Object.freeze({
  VALID: "valid",
  TAMPERED: "tampered",
  MALFORMED: "malformed",
  UNSUPPORTED_SCHEMA: "unsupported-schema",
  MISSING_RECEIPT: "missing-receipt",
  WRONG_FORMAT: "wrong-format",
  MISMATCHED_IDENTIFIERS: "mismatched-identifiers",
});

const RECEIPT_ID_PATTERN = /^receipt_[0-9a-f]{64}$/;
const REQUIRED_RECEIPT_FIELDS = [
  "receiptId",
  "schemaVersion",
  "trigger",
  "plan",
  "checks",
  "errors",
  "limitations",
  "finalDisposition",
  "explorerLinks",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function result(status, message, details = {}) {
  return {
    status,
    verified: status === REVIEW_PACKET_VERIFICATION_STATUS.VALID,
    message,
    ...details,
  };
}

function malformedPacket(message) {
  return result(REVIEW_PACKET_VERIFICATION_STATUS.MALFORMED, message);
}

function validatePacketShape(packet) {
  if (!isRecord(packet)) return malformedPacket("The selected JSON value is not a Watchtower review packet.");
  if (packet.format !== REVIEW_PACKET_FORMAT) {
    return result(
      REVIEW_PACKET_VERIFICATION_STATUS.WRONG_FORMAT,
      "This JSON file is not a Watchtower review packet.",
    );
  }
  if (packet.schemaVersion !== REVIEW_PACKET_SCHEMA_VERSION) {
    return result(
      REVIEW_PACKET_VERIFICATION_STATUS.UNSUPPORTED_SCHEMA,
      `This packet uses schema version ${String(packet.schemaVersion)}, but this browser supports version ${REVIEW_PACKET_SCHEMA_VERSION}.`,
    );
  }
  if (!Object.hasOwn(packet, "receipt") || !isRecord(packet.receipt) || !isRecord(packet.receipt.canonical)) {
    return result(
      REVIEW_PACKET_VERIFICATION_STATUS.MISSING_RECEIPT,
      "This packet does not include a canonical receipt to verify.",
    );
  }

  const receipt = packet.receipt;
  const canonical = receipt.canonical;
  if (typeof receipt.identifier !== "string" || !RECEIPT_ID_PATTERN.test(receipt.identifier)) {
    return malformedPacket("The packet receipt identifier is missing or malformed.");
  }
  if (typeof canonical.receiptId !== "string" || !RECEIPT_ID_PATTERN.test(canonical.receiptId)) {
    return malformedPacket("The canonical receipt identifier is missing or malformed.");
  }
  if (canonical.schemaVersion !== 1) {
    return result(
      REVIEW_PACKET_VERIFICATION_STATUS.UNSUPPORTED_SCHEMA,
      `The canonical receipt uses schema version ${String(canonical.schemaVersion)}, but this verifier supports receipt schema version 1.`,
    );
  }
  if (REQUIRED_RECEIPT_FIELDS.some((field) => !Object.hasOwn(canonical, field))) {
    return malformedPacket("The canonical receipt is missing required fields.");
  }
  return null;
}

export function parseReviewPacketText(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return malformedPacket("The selected file is empty or does not contain JSON.");
  }
  let packet;
  try {
    packet = JSON.parse(text);
  } catch {
    return malformedPacket("The selected file is not valid JSON.");
  }
  const shapeError = validatePacketShape(packet);
  if (shapeError) return shapeError;
  return { status: "parsed", verified: false, packet };
}

export async function verifyReviewPacket(packet) {
  const shapeError = validatePacketShape(packet);
  if (shapeError) return shapeError;

  const receipt = packet.receipt;
  const canonical = receipt.canonical;
  if (receipt.identifier !== canonical.receiptId) {
    return result(
      REVIEW_PACKET_VERIFICATION_STATUS.MISMATCHED_IDENTIFIERS,
      "The packet receipt identifier does not match the canonical receipt identifier.",
      {
        receiptIdentifier: receipt.identifier,
        canonicalReceiptId: canonical.receiptId,
      },
    );
  }

  let verification;
  try {
    verification = await verifyReceipt(canonical);
  } catch {
    return malformedPacket("The canonical receipt could not be recomputed from its recorded fields.");
  }

  const computedReceiptId = verification.expectedReceiptId;
  const details = {
    receiptIdentifier: receipt.identifier,
    canonicalReceiptId: canonical.receiptId,
    computedReceiptId,
  };
  if (computedReceiptId !== canonical.receiptId) {
    return result(
      REVIEW_PACKET_VERIFICATION_STATUS.TAMPERED,
      "The canonical receipt ID does not match its recomputed SHA-256 value. The packet may have been changed.",
      details,
    );
  }
  return result(
    REVIEW_PACKET_VERIFICATION_STATUS.VALID,
    "Canonical receipt verified. Unhashed packet fields are not covered by this receipt ID.",
    details,
  );
}

export async function verifyReviewPacketText(text) {
  const parsed = parseReviewPacketText(text);
  if (parsed.status !== "parsed") return parsed;
  return verifyReviewPacket(parsed.packet);
}
