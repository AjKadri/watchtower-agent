import { hexToBigInt, keccak256, toHex } from "viem";

import { RpcReadError, type RpcFailureCategory } from "../chain/errors.js";
import type { Address, ChainReader, Hex } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import type { UpgradeInvestigation, UpgradeInvestigationCheck } from "../domain/schemas.js";
import { upgradeInvestigationSchema } from "../domain/schemas.js";
import { evmAwareEqual, normalizeEvmAddress, sameEvmAddress } from "../evm/address.js";
import type { ProfileInvestigationCheck } from "../profiles/registry.js";
import { planForProfile } from "../profiles/registry.js";
import {
  investigationPlanSchema,
  selectInvestigationPlan,
  type InvestigationCapability,
  type InvestigationPlan,
} from "./plans.js";

type CheckResult = NonNullable<UpgradeInvestigationCheck["result"]>;

class ReadBudget {
  readonly #maximumReads: number;
  readonly #maximumUses: Map<InvestigationCapability, number>;
  readonly #uses = new Map<InvestigationCapability, number>();
  #reads = 0;

  constructor(plan: InvestigationPlan) {
    this.#maximumReads = plan.capabilityBudget.maximumReads;
    this.#maximumUses = new Map(plan.capabilityBudget.capabilities.map(({ name, maximumUses }) => [name, maximumUses]));
  }

  consume(capability: InvestigationCapability): void {
    const maximumUses = this.#maximumUses.get(capability);
    const uses = this.#uses.get(capability) ?? 0;
    if (maximumUses === undefined || uses >= maximumUses || this.#reads >= this.#maximumReads) {
      throw new Error("The fixed investigation capability budget was exceeded.");
    }
    this.#uses.set(capability, uses + 1);
    this.#reads += 1;
  }
}

function normalizeAddressWord(value: Hex): Address {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new RpcReadError("historical address result", "malformed-response");
  }
  return normalizeEvmAddress(`0x${value.slice(-40)}`);
}

function normalizeUint256(value: Hex): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new RpcReadError("historical uint256 result", "malformed-response");
  }
  return hexToBigInt(value).toString();
}

function rpcCategory(error: unknown): RpcFailureCategory {
  return error instanceof RpcReadError ? error.category : "unavailable";
}

function blockNumberFor(config: TargetConfig, check: ProfileInvestigationCheck): bigint {
  return BigInt(check.block === "previous" ? config.investigation.previousBlock : config.investigation.upgradeBlock);
}

function parametersFor(check: ProfileInvestigationCheck, implementation: Address): Record<string, string> {
  if (check.kind === "storage-address") return { address: check.address, slot: check.slot };
  if (check.kind === "implementation-code") return { address: implementation };
  return { to: check.to, data: check.data };
}

function expectedFor(check: ProfileInvestigationCheck): string {
  if (check.kind === "storage-address" || check.kind === "call-address") return check.expectedAddress;
  if (check.kind === "implementation-code") return `${check.expectedByteLength} bytes`;
  return check.expectedValue;
}

async function readCheck(
  reader: ChainReader,
  check: ProfileInvestigationCheck,
  implementation: Address,
  blockNumber: bigint,
): Promise<CheckResult> {
  if (check.kind === "storage-address") {
    return { kind: "address", value: normalizeAddressWord(await reader.getStorageAt(check.address as Address, check.slot as Hex, blockNumber)) };
  }
  if (check.kind === "implementation-code") {
    const code = await reader.getCode(implementation, blockNumber);
    if (!/^0x(?:[0-9a-f]{2})*$/i.test(code)) {
      throw new RpcReadError("historical code result", "malformed-response");
    }
    return {
      kind: "bytecode",
      present: code !== "0x",
      byteLength: String((code.length - 2) / 2),
      hash: keccak256(code),
    };
  }
  const result = await reader.call(check.to, check.data as Hex, blockNumber);
  if (check.kind === "call-address") return { kind: "address", value: normalizeAddressWord(result) };
  return { kind: "uint256", value: normalizeUint256(result) };
}

function actualFor(result: CheckResult): string {
  if (result.kind === "bytecode") return `${result.byteLength} bytes`;
  return result.value;
}

function matchesCheck(check: ProfileInvestigationCheck, result: CheckResult, implementation: Address): boolean {
  if (check.kind === "storage-address") {
    return result.kind === "address"
      && sameEvmAddress(result.value, check.expectedAddress)
      && (!check.mustMatchDecodedImplementation || sameEvmAddress(result.value, implementation));
  }
  if (check.kind === "implementation-code") {
    return result.kind === "bytecode"
      && result.present
      && result.byteLength === check.expectedByteLength
      && sameEvmAddress(implementation, check.expectedApprovedImplementation);
  }
  if (check.kind === "call-address") {
    return result.kind === "address" && sameEvmAddress(result.value, check.expectedAddress);
  }
  return result.kind === "uint256" && result.value === check.expectedValue;
}

async function executeCheck(
  reader: ChainReader,
  config: TargetConfig,
  definition: ProfileInvestigationCheck,
  implementation: Address,
): Promise<UpgradeInvestigationCheck> {
  const blockNumber = blockNumberFor(config, definition);
  const parameters = parametersFor(definition, implementation);
  const expected = expectedFor(definition);
  try {
    const result = await readCheck(reader, definition, implementation, blockNumber);
    const actual = actualFor(result);
    const matches = matchesCheck(definition, result, implementation);
    return {
      id: definition.id,
      required: definition.required,
      method: definition.method,
      parameters,
      blockTag: toHex(blockNumber),
      result,
      assertion: { description: definition.description, expected, actual, matches },
      status: matches ? "passed" : "mismatch",
      failure: null,
    };
  } catch (error) {
    const category = rpcCategory(error);
    return {
      id: definition.id,
      required: definition.required,
      method: definition.method,
      parameters,
      blockTag: toHex(blockNumber),
      result: null,
      assertion: {
        description: definition.description,
        expected,
        actual: null,
        matches: null,
      },
      status: category === "unsupported" ? "unsupported" : "failed",
      failure: {
        code: `${definition.id}-${category}`,
        category,
        message: `The ${definition.id} check could not be verified at its configured historical block.`,
      },
    };
  }
}

export async function investigateApprovedUpgrade(
  reader: ChainReader,
  config: TargetConfig,
  decodedImplementation: Address,
  selectedPlan: InvestigationPlan = selectInvestigationPlan({
    targetId: config.target.id,
    eventSignature: config.detectors[0].eventSignature,
    triggerEvidenceStatus: "complete",
    severityRuleId: "target-is-approved",
  }),
): Promise<UpgradeInvestigation> {
  const plan = investigationPlanSchema.parse(selectedPlan);
  const expectedPlan = planForProfile(config, plan.id);
  if (!evmAwareEqual(plan, expectedPlan)) {
    throw new Error("The selected investigation plan does not belong to the configured target profile.");
  }
  const implementation = normalizeEvmAddress(decodedImplementation);
  const definitionsById = new Map(config.investigation.checks.map((definition) => [definition.id, definition]));
  const budget = new ReadBudget(plan);
  const selectedDefinitions = plan.selectedChecks.map((id) => {
    const definition = definitionsById.get(id);
    if (!definition) throw new Error("The selected investigation plan contains an unknown profile check.");
    budget.consume(definition.capability);
    return definition;
  });
  const checks = await Promise.all(selectedDefinitions.map((definition) => executeCheck(reader, config, definition, implementation)));

  const requiredChecks = checks.filter(({ required }) => required);
  const disposition = plan.id === "stop-incomplete"
    ? "incomplete"
    : requiredChecks.some(({ status }) => status === "mismatch")
      ? "contradicted"
      : requiredChecks.some(({ status }) => status === "failed" || status === "unsupported")
        ? "incomplete"
        : "corroborated";
  const evidenceStatus = plan.id === "stop-incomplete" || checks.some(({ status }) => status === "failed" || status === "unsupported")
    ? "incomplete"
    : "complete";

  return upgradeInvestigationSchema.parse({ plan, disposition, evidenceStatus, checks });
}
