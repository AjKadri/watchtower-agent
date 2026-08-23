import { decodeEventLog, parseAbiItem, toEventSelector, type AbiEvent, type Address, type Hex } from "viem";
import { z } from "zod";

export const upgradedEvent = parseAbiItem("event Upgraded(address indexed implementation)");
export const upgradedEventAbi = [upgradedEvent] as const;
export const upgradedEventType = "proxy_upgraded" as const;

const committedUpgradeAbiSchema = z.tuple([
  z.object({
    type: z.literal("event"),
    name: z.literal("Upgraded"),
    anonymous: z.literal(false),
    inputs: z.tuple([
      z.object({
        indexed: z.literal(true),
        name: z.literal("implementation"),
        type: z.literal("address"),
      }).strict(),
    ]),
  }).strict(),
]);

export function validateUpgradeEventAbi(value: unknown, configuredTopic: Hex): readonly [AbiEvent] {
  const parsed = committedUpgradeAbiSchema.parse(value) as unknown as readonly [AbiEvent];
  const committedTopic = toEventSelector(parsed[0]);
  const runtimeTopic = toEventSelector(upgradedEvent);
  if (committedTopic.toLowerCase() !== configuredTopic.toLowerCase() || runtimeTopic !== committedTopic) {
    throw new Error("The committed upgrade ABI, configured topic, and runtime decoder do not match.");
  }
  return parsed;
}

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
