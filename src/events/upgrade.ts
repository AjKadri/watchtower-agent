import { decodeEventLog, parseAbiItem, type Address, type Hex } from "viem";

export const upgradedEvent = parseAbiItem("event Upgraded(address indexed implementation)");
export const upgradedEventAbi = [upgradedEvent] as const;

export function decodeUpgradeLog(data: Hex, topics: readonly Hex[]): Address {
  const decoded = decodeEventLog({
    abi: upgradedEventAbi,
    data,
    topics: topics as [Hex, ...Hex[]],
    strict: true,
  });

  if (decoded.eventName !== "Upgraded" || !("implementation" in decoded.args)) {
    throw new Error("log did not decode as Upgraded(address)");
  }

  return decoded.args.implementation;
}
