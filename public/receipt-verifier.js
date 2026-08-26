const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const MASK_64 = (1n << 64n) - 1n;
const KECCAK_RATE = 136;
const KECCAK_ROUNDS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROTATIONS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotateLeft64(value, shift) {
  if (shift === 0) return value;
  const bits = BigInt(shift);
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

function keccakPermutation(state) {
  for (const roundConstant of KECCAK_ROUNDS) {
    const columns = Array.from({ length: 5 }, (_, x) => (
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    ));
    const deltas = columns.map((_, x) => columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1));
    for (let index = 0; index < 25; index += 1) state[index] = (state[index] ^ deltas[index % 5]) & MASK_64;

    const rotated = Array(25).fill(0n);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        rotated[y + (5 * ((2 * x + 3 * y) % 5))] = rotateLeft64(state[x + (5 * y)], KECCAK_ROTATIONS[x + (5 * y)]);
      }
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const current = rotated[x + (5 * y)];
        const next = rotated[((x + 1) % 5) + (5 * y)];
        const afterNext = rotated[((x + 2) % 5) + (5 * y)];
        state[x + (5 * y)] = (current ^ ((~next) & afterNext)) & MASK_64;
      }
    }
    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}

function keccak256(value) {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 1) / KECCAK_RATE) * KECCAK_RATE;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const state = Array(25).fill(0n);

  for (let offset = 0; offset < padded.length; offset += KECCAK_RATE) {
    for (let index = 0; index < KECCAK_RATE; index += 1) {
      state[Math.floor(index / 8)] ^= BigInt(padded[offset + index]) << BigInt((index % 8) * 8);
    }
    keccakPermutation(state);
  }

  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number((state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return [...output].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeEvmAddress(value) {
  if (!EVM_ADDRESS_PATTERN.test(value)) throw new TypeError("Expected an Ethereum address.");
  const lowercase = value.slice(2).toLowerCase();
  const hash = keccak256(lowercase);
  return `0x${[...lowercase].map((character, index) => (
    Number.parseInt(hash[index], 16) >= 8 ? character.toUpperCase() : character
  )).join("")}`;
}

export function normalizeEvmAddresses(value) {
  if (typeof value === "string" && EVM_ADDRESS_PATTERN.test(value)) return normalizeEvmAddress(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeEvmAddresses);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeEvmAddresses(item)]));
}

export function stableSerialize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new TypeError("Canonical serialization accepts JSON values only.");
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalReceiptPayload(receipt) {
  if (receipt === null || typeof receipt !== "object") throw new TypeError("Expected a receipt object.");
  const checks = Array.isArray(receipt.checks)
    ? receipt.checks.map((check) => {
        if (check === null || typeof check !== "object" || Array.isArray(check)) return check;
        const { elapsedMs: _elapsedMs, ...canonicalCheck } = check;
        return canonicalCheck;
      })
    : receipt.checks;
  return normalizeEvmAddresses({
    schemaVersion: receipt.schemaVersion,
    trigger: receipt.trigger,
    plan: receipt.plan,
    checks,
    errors: receipt.errors,
    limitations: receipt.limitations,
    finalDisposition: receipt.finalDisposition,
    explorerLinks: receipt.explorerLinks,
  });
}

export async function createReceiptId(receipt) {
  const canonical = stableSerialize(canonicalReceiptPayload(receipt));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `receipt_${hex}`;
}

export async function verifyReceipt(receipt) {
  const expectedReceiptId = await createReceiptId(receipt);
  return {
    verified: typeof receipt.receiptId === "string" && receipt.receiptId === expectedReceiptId,
    expectedReceiptId,
  };
}
