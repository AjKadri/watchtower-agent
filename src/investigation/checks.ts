import { hexToBigInt, keccak256, toHex } from "viem";

import { RpcReadError, type RpcFailureCategory } from "../chain/errors.js";
import type { Address, ChainReader, Hex } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import type { UpgradeInvestigationCheck } from "../domain/schemas.js";
import { normalizeEvmAddress, sameEvmAddress } from "../evm/address.js";
import type { ProfileInvestigationCheck } from "../profiles/registry.js";
import { planForProfile } from "../profiles/registry.js";
import {
  investigationPlanSchema,
  type InvestigationCapability,
  type InvestigationCheckId,
  type InvestigationPlan,
} from "./plans.js";

type CheckResult = NonNullable<UpgradeInvestigationCheck["result"]>;
type CheckOptions = { signal?: AbortSignal; now?: () => number };

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
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new RpcReadError("historical address result", "malformed-response");
  return normalizeEvmAddress(`0x${value.slice(-40)}`);
}

function normalizeUint256(value: Hex): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new RpcReadError("historical uint256 result", "malformed-response");
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
  signal?: AbortSignal,
): Promise<CheckResult> {
  if (check.kind === "storage-address") {
    return { kind: "address", value: normalizeAddressWord(await reader.getStorageAt(check.address as Address, check.slot as Hex, blockNumber, signal)) };
  }
  if (check.kind === "implementation-code") {
    const code = await reader.getCode(implementation, blockNumber, signal);
    if (!/^0x(?:[0-9a-f]{2})*$/i.test(code)) throw new RpcReadError("historical code result", "malformed-response");
    return { kind: "bytecode", present: code !== "0x", byteLength: String((code.length - 2) / 2), hash: keccak256(code) };
  }
  const result = await reader.call(check.to, check.data as Hex, blockNumber, signal);
  if (check.kind === "call-address") return { kind: "address", value: normalizeAddressWord(result) };
  return { kind: "uint256", value: normalizeUint256(result) };
}

function actualFor(result: CheckResult): string {
  return result.kind === "bytecode" ? `${result.byteLength} bytes` : result.value;
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
  if (check.kind === "call-address") return result.kind === "address" && sameEvmAddress(result.value, check.expectedAddress);
  return result.kind === "uint256" && result.value === check.expectedValue;
}

export async function executeRegisteredCheck(
  reader: ChainReader,
  config: TargetConfig,
  definition: ProfileInvestigationCheck,
  implementation: Address,
  options: CheckOptions = {},
): Promise<UpgradeInvestigationCheck> {
  const now = options.now ?? performance.now.bind(performance);
  const startedAt = now();
  const elapsedMs = () => Math.max(0, Math.round(now() - startedAt));
  const blockNumber = blockNumberFor(config, definition);
  const parameters = parametersFor(definition, implementation);
  const expected = expectedFor(definition);
  try {
    const result = await readCheck(reader, definition, implementation, blockNumber, options.signal);
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
      elapsedMs: elapsedMs(),
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
      assertion: { description: definition.description, expected, actual: null, matches: null },
      status: category === "unsupported" ? "unsupported" : "failed",
      failure: {
        code: `${definition.id}-${category}`,
        category,
        message: `The ${definition.id} check could not be verified at its configured historical block.`,
      },
      elapsedMs: elapsedMs(),
    };
  }
}

export class RegisteredCheckExecutor {
  readonly #definitions: Map<InvestigationCheckId, ProfileInvestigationCheck>;
  readonly #results = new Map<InvestigationCheckId, UpgradeInvestigationCheck>();
  readonly #budget: ReadBudget;
  readonly plan: InvestigationPlan;

  constructor(
    private readonly reader: ChainReader,
    private readonly config: TargetConfig,
    private readonly implementation: Address,
    planInput: InvestigationPlan,
    private readonly options: CheckOptions = {},
  ) {
    this.plan = investigationPlanSchema.parse(planInput);
    const expectedPlan = planForProfile(config, this.plan.id);
    if (JSON.stringify(this.plan) !== JSON.stringify(expectedPlan)) {
      throw new Error("The selected investigation plan does not belong to the configured target profile.");
    }
    this.#definitions = new Map(config.investigation.checks.map((definition) => [definition.id, definition]));
    this.#budget = new ReadBudget(this.plan);
  }

  remainingCheckIds(): InvestigationCheckId[] {
    return this.plan.selectedChecks.filter((id) => !this.#results.has(id));
  }

  completedChecks(): UpgradeInvestigationCheck[] {
    return this.plan.selectedChecks.flatMap((id) => {
      const result = this.#results.get(id);
      return result ? [result] : [];
    });
  }

  async run(checkId: InvestigationCheckId): Promise<UpgradeInvestigationCheck> {
    if (!this.plan.selectedChecks.includes(checkId)) throw new Error("The requested check is outside the selected investigation plan.");
    if (this.#results.has(checkId)) throw new Error("The requested investigation check has already run.");
    const definition = this.#definitions.get(checkId);
    if (!definition) throw new Error("The requested check is not registered for the selected target profile.");
    this.#budget.consume(definition.capability);
    const result = await executeRegisteredCheck(this.reader, this.config, definition, this.implementation, this.options);
    this.#results.set(checkId, result);
    return result;
  }

  async runRemainingRequired(): Promise<void> {
    await Promise.all(this.remainingCheckIds().map((checkId) => this.run(checkId)));
  }
}
