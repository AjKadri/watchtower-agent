import { getAddress } from "viem";

import type { Address } from "../chain/types.js";

export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isEvmAddress(value: unknown): value is Address {
  return typeof value === "string" && EVM_ADDRESS_PATTERN.test(value);
}

export function normalizeEvmAddress(value: string): Address {
  if (!isEvmAddress(value)) throw new TypeError("Expected an Ethereum address.");
  return getAddress(value.toLowerCase());
}

export function sameEvmAddress(left: string, right: string): boolean {
  return isEvmAddress(left)
    && isEvmAddress(right)
    && normalizeEvmAddress(left) === normalizeEvmAddress(right);
}

export function evmAwareStringEqual(left: string, right: string): boolean {
  if (isEvmAddress(left) || isEvmAddress(right)) return sameEvmAddress(left, right);
  return left === right;
}

export function evmAwareEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") return evmAwareStringEqual(left, right);
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => evmAwareEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && evmAwareEqual(leftRecord[key], rightRecord[key]));
}

export function normalizeEvmAddresses<T>(value: T): T {
  if (isEvmAddress(value)) return normalizeEvmAddress(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => normalizeEvmAddresses(item)) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeEvmAddresses(item)]),
  ) as T;
}
