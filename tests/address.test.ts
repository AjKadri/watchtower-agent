import { describe, expect, it } from "vitest";

import { normalizeEvmAddress, normalizeEvmAddresses } from "../src/evm/address.js";

describe("EVM address normalization", () => {
  it("normalizes lowercase and checksum forms to one semantic value", () => {
    expect(normalizeEvmAddress("0xdb578d67a83e94de73c9e0c14280f804f6c1c3e4")).toBe(
      "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4",
    );
  });

  it("does not normalize hashes, URLs, or arbitrary strings", () => {
    const input = {
      address: "0xdb578d67a83e94de73c9e0c14280f804f6c1c3e4",
      hash: `0x${"A".repeat(64)}`,
      url: "https://basescan.org/address/0xdb578d67a83e94de73c9e0c14280f804f6c1c3e4",
      label: "Contract Upgrade",
    };

    expect(normalizeEvmAddresses(input)).toEqual({
      ...input,
      address: "0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4",
    });
  });
});
