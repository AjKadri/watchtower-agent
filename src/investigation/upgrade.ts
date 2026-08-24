import { getAddress, hexToBigInt, keccak256, toHex } from "viem";

import { RpcReadError, type RpcFailureCategory } from "../chain/errors.js";
import type { Address, ChainReader, Hex } from "../chain/types.js";
import type { TargetConfig } from "../config/schema.js";
import type { UpgradeInvestigation, UpgradeInvestigationCheck } from "../domain/schemas.js";
import { upgradeInvestigationSchema } from "../domain/schemas.js";
import {
  investigationPlanSchema,
  selectInvestigationPlan,
  type InvestigationCapability,
  type InvestigationPlan,
} from "./plans.js";

type CheckId = UpgradeInvestigationCheck["id"];
type CheckMethod = UpgradeInvestigationCheck["method"];
type CheckResult = NonNullable<UpgradeInvestigationCheck["result"]>;

type CheckDefinition = {
  id: CheckId;
  required: boolean;
  method: CheckMethod;
  capability: InvestigationCapability;
  parameters: Record<string, string>;
  blockNumber: bigint;
  description: string;
  expected: string;
  read: () => Promise<CheckResult>;
  actual: (result: CheckResult) => string;
  matches: (result: CheckResult) => boolean;
};

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
  return `0x${value.slice(-40).toLowerCase()}`;
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

async function executeCheck(definition: CheckDefinition): Promise<UpgradeInvestigationCheck> {
  try {
    const result = await definition.read();
    const actual = definition.actual(result);
    const matches = definition.matches(result);
    return {
      id: definition.id,
      required: definition.required,
      method: definition.method,
      parameters: definition.parameters,
      blockTag: toHex(definition.blockNumber),
      result,
      assertion: {
        description: definition.description,
        expected: definition.expected,
        actual,
        matches,
      },
      status: matches ? "passed" : "mismatch",
      failure: null,
    };
  } catch (error) {
    const category = rpcCategory(error);
    return {
      id: definition.id,
      required: definition.required,
      method: definition.method,
      parameters: definition.parameters,
      blockTag: toHex(definition.blockNumber),
      result: null,
      assertion: {
        description: definition.description,
        expected: definition.expected,
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
    targetId: "aave-v3-base-core",
    eventSignature: "Upgraded(address)",
    triggerEvidenceStatus: "complete",
    severityRuleId: "target-is-approved",
  }),
): Promise<UpgradeInvestigation> {
  const plan = investigationPlanSchema.parse(selectedPlan);
  const investigation = config.investigation;
  const previousBlock = BigInt(investigation.previousBlock);
  const upgradeBlock = BigInt(investigation.upgradeBlock);
  const proxy = config.target.primaryContract.address;
  const provider = investigation.poolAddressesProvider;
  const expected = investigation.expected;
  const implementation = getAddress(decodedImplementation);

  const definitions: CheckDefinition[] = [
    {
      id: "implementation-before",
      required: true,
      method: "eth_getStorageAt",
      capability: "historical-storage-read",
      parameters: { address: proxy, slot: investigation.implementationSlot },
      blockNumber: previousBlock,
      description: "The configured proxy implementation slot at N-1 matches the verified pre-upgrade implementation.",
      expected: expected.implementationBefore.toLowerCase(),
      read: async () => ({ kind: "address", value: normalizeAddressWord(await reader.getStorageAt(proxy, investigation.implementationSlot, previousBlock)) }),
      actual: (result) => result.kind === "address" ? result.value.toLowerCase() : "invalid-result-kind",
      matches: (result) => result.kind === "address" && result.value.toLowerCase() === expected.implementationBefore.toLowerCase(),
    },
    {
      id: "implementation-at-upgrade",
      required: true,
      method: "eth_getStorageAt",
      capability: "historical-storage-read",
      parameters: { address: proxy, slot: investigation.implementationSlot },
      blockNumber: upgradeBlock,
      description: "The configured proxy implementation slot at N matches both the approved and decoded implementation.",
      expected: expected.implementationAfter.toLowerCase(),
      read: async () => ({ kind: "address", value: normalizeAddressWord(await reader.getStorageAt(proxy, investigation.implementationSlot, upgradeBlock)) }),
      actual: (result) => result.kind === "address" ? result.value.toLowerCase() : "invalid-result-kind",
      matches: (result) => result.kind === "address"
        && result.value.toLowerCase() === expected.implementationAfter.toLowerCase()
        && implementation.toLowerCase() === expected.implementationAfter.toLowerCase(),
    },
    {
      id: "implementation-bytecode",
      required: true,
      method: "eth_getCode",
      capability: "historical-code-read",
      parameters: { address: implementation },
      blockNumber: upgradeBlock,
      description: "The decoded implementation has the verified deployed bytecode length at N.",
      expected: `${expected.implementationByteLength} bytes`,
      read: async () => {
        const code = await reader.getCode(implementation, upgradeBlock);
        if (!/^0x(?:[0-9a-f]{2})*$/i.test(code)) {
          throw new RpcReadError("historical code result", "malformed-response");
        }
        return { kind: "bytecode", present: code !== "0x", byteLength: String((code.length - 2) / 2), hash: keccak256(code) };
      },
      actual: (result) => result.kind === "bytecode" ? `${result.byteLength} bytes` : "invalid-result-kind",
      matches: (result) => result.kind === "bytecode" && result.present && result.byteLength === expected.implementationByteLength,
    },
    {
      id: "configured-pool",
      required: true,
      method: "eth_call",
      capability: "historical-contract-call",
      parameters: { to: provider, data: investigation.getPoolCallData },
      blockNumber: upgradeBlock,
      description: "The configured PoolAddressesProvider returns the configured Pool proxy at N.",
      expected: expected.pool.toLowerCase(),
      read: async () => ({ kind: "address", value: normalizeAddressWord(await reader.call(provider, investigation.getPoolCallData, upgradeBlock)) }),
      actual: (result) => result.kind === "address" ? result.value.toLowerCase() : "invalid-result-kind",
      matches: (result) => result.kind === "address" && result.value.toLowerCase() === expected.pool.toLowerCase(),
    },
    {
      id: "pool-revision-before",
      required: false,
      method: "eth_call",
      capability: "historical-contract-call",
      parameters: { to: proxy, data: investigation.poolRevisionCallData },
      blockNumber: previousBlock,
      description: "Optional POOL_REVISION() corroboration at N-1 matches the verified fixture.",
      expected: expected.poolRevisionBefore,
      read: async () => ({ kind: "uint256", value: normalizeUint256(await reader.call(proxy, investigation.poolRevisionCallData, previousBlock)) }),
      actual: (result) => result.kind === "uint256" ? result.value : "invalid-result-kind",
      matches: (result) => result.kind === "uint256" && result.value === expected.poolRevisionBefore,
    },
    {
      id: "pool-revision-at-upgrade",
      required: false,
      method: "eth_call",
      capability: "historical-contract-call",
      parameters: { to: proxy, data: investigation.poolRevisionCallData },
      blockNumber: upgradeBlock,
      description: "Optional POOL_REVISION() corroboration at N matches the verified fixture.",
      expected: expected.poolRevisionAfter,
      read: async () => ({ kind: "uint256", value: normalizeUint256(await reader.call(proxy, investigation.poolRevisionCallData, upgradeBlock)) }),
      actual: (result) => result.kind === "uint256" ? result.value : "invalid-result-kind",
      matches: (result) => result.kind === "uint256" && result.value === expected.poolRevisionAfter,
    },
  ];

  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const budget = new ReadBudget(plan);
  const selectedDefinitions = plan.selectedChecks.map((id) => {
    const definition = definitionsById.get(id);
    if (!definition) throw new Error("The selected investigation plan contains an unknown check.");
    budget.consume(definition.capability);
    return definition;
  });
  const checks = await Promise.all(selectedDefinitions.map(executeCheck));

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
