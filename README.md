# Watchtower

## The problem

An upgrade event says that a proxy changed implementation. It does not establish
what state existed before the transaction, whether code existed at the decoded
implementation, or whether the contract still matched protocol-specific
identity values at that historical block.

## Who Watchtower is for

Watchtower serves protocol security teams, incident responders, auditors, and
researchers who need a reproducible upgrade investigation instead of an
unsupported narrative.

## What Watchtower does

Watchtower turns one configured `Upgraded(address)` event into a bounded,
read-only historical investigation. It verifies the trigger evidence, selects a
fixed deterministic plan, runs exact-block checks, derives a deterministic
disposition, and issues a replayable receipt that the browser can verify
independently.

- [Live public demo](https://watchtower.ajkadri.dev)
- [Run the demo locally](#run-the-demo)
- [GitHub repository](https://github.com/AjKadri/watchtower-agent)
- [Aave fixture transaction](https://basescan.org/tx/0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a)
- [Compound fixture transaction](https://basescan.org/tx/0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4)
- [ether.fi fixture transaction](https://basescan.org/tx/0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2)

Watchtower is live at [watchtower.ajkadri.dev](https://watchtower.ajkadri.dev).
The hosted demo supports the three committed, verified investigation fixtures
and live historical ether.fi investigation when its configured archive RPC is
available. The same bounded demo can also be reproduced locally.

## Supported profiles

Watchtower has a closed registry of three profiles. Clients cannot submit an
address, RPC URL, event signature, call, plan, or block range outside the
server-selected profile.

| Profile | Verified upgrade | Fixed protocol checks |
| --- | --- | --- |
| Aave V3 Base Pool | [Block 41105890](https://basescan.org/block/41105890) | EIP-1967 implementation before and after, implementation bytecode, `getPool()`, optional `POOL_REVISION()` before and after |
| Compound III Base USDC Comet | [Block 40235590](https://basescan.org/block/40235590) | EIP-1967 implementation before and after, implementation bytecode, `governor()` before and after, `baseToken()` |
| ether.fi Base weETH OFT | [Block 23487559](https://basescan.org/block/23487559) | EIP-1967 implementation before and after, implementation bytecode, `endpoint()`, `token()`, `sharedDecimals()` |

The committed fixtures contain only real evidence from these three upgrades.
The active live-scan profile is ether.fi Base weETH OFT.

## Six-stage investigation

1. Event observed. Verify the configured proxy, transaction, log, topic, and
   decoded implementation.
2. Plan selected. Choose exactly one versioned plan with a fixed capability and
   read budget.
3. Historical state checked. Read the EIP-1967 implementation slot at the
   profile's exact N-1 and N block tags.
4. Implementation checked. Confirm bytecode at the decoded implementation at N.
5. Protocol identity checked. Execute only the profile's fixed historical calls.
6. Receipt issued. Bind the trigger, plan, checks, limitations, links, and
   disposition into canonical JSON.

The interface tells the full 60-second story: choose one of the three profiles,
inspect its real historical event, follow plan selection and bounded checks,
see the disposition resolve, open the receipt, then recompute its SHA-256 ID in
the browser. Every investigation is explicitly labeled `Live RPC
investigation`, `Verified fixture replay`, `Incomplete investigation`, or
`Failed investigation`. A replay never appears as a live scan.

## What the evidence proves

A complete investigation establishes that Watchtower observed the configured
upgrade event in the qualifying transaction, verified its block, transaction,
receipt, and log, and executed the profile's fixed historical checks at their
exact block tags.

Each receipt records:

- complete trigger evidence
- the selected versioned investigation plan and reason
- selected and skipped checks
- the fixed read and capability budget
- every RPC method, safe parameter, block tag, normalized result, assertion,
  status, measured check duration, and safe failure
- the final `corroborated`, `contradicted`, or `incomplete` disposition
- direct explorer links

The receipt ID is a SHA-256 hash of a canonical payload that excludes the ID
itself and measured `elapsedMs` fields. Timings remain in the receipt and API
response, but they are not hash-bound because real execution duration varies
between otherwise identical replays. Server validation checks consistency
across the trigger, evidence, plan, checks, disposition, and links. The receipt view independently
reconstructs the canonical payload, normalizes Ethereum addresses, and
recomputes the ID with browser Web Crypto. Equivalent address casing produces
the same receipt ID.

Committed fixture replays do not invent runtime duration. Their trace states
`Timing not recorded for fixture replay` when a check has no measured fixture
timing. The ether.fi fixture and approved live canonical payload both recompute
to `receipt_af9ac18199f550c4d6ccf64a16334dd03afbbe3a3bf06c705347e16684bd64b5`.

These receipts prove the recorded observations and deterministic assertions.
They do not prove upgrade intent, governance legitimacy, implementation safety,
remote cross-chain safety, or the security of related contracts.

The final disposition, severity, assertions, and receipt hash are deterministic.
No LLM participates in the verdict path.

## Orion judging criteria

| Criterion | Watchtower evidence |
| --- | --- |
| Usefulness | Gives security teams a bounded way to verify what changed during a supported Base upgrade. |
| Execution | Combines archive RPC reads, runtime validation, deterministic planning, visible failures, and a focused investigation interface. |
| Originality | Produces an evidence-bounded replay receipt instead of relying on a generated incident narrative. |
| Verifiability | Ships real fixtures, exact block tags, BaseScan links, normalized assertions, and independent browser receipt hashing. |
| Ecosystem fit | Demonstrates a read-only investigation agent for three verified Base protocol profiles with closed capabilities and deterministic outputs. |

## Architecture

```text
Closed target registry
        |
        v
Bounded viem Base reader -> runtime-validated chain evidence
        |
        v
Deterministic plan and fixed historical checks
        |
        v
Normalized alert, investigation, and canonical receipt
        |
        v
Express API and in-memory store -> vanilla investigation workspace
```

- TypeScript modules keep scanning, validation, planning, and receipt creation
  independent from Express.
- viem provides read-only Base JSON-RPC access.
- Zod validates configuration, chain evidence, scan results, and cross-object
  receipt invariants at runtime.
- Express exposes the API and static interface.
- Vanilla HTML, CSS, and JavaScript render the archive, investigation trace,
  evidence details, failures, receipt downloads, and browser-side receipt
  verification.
- Process memory is sufficient because the bounded scans and deterministic IDs
  reproduce the same records from Base. Committed fixtures provide the public
  archive.

## Run the demo

Requirements:

- Node.js 24.x
- npm 11.x

```sh
git clone https://github.com/AjKadri/watchtower-agent.git
cd watchtower-agent
nvm use
npm ci
cp .env.example .env
npm test
npm run typecheck
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The three fixture replays
are available immediately.

The live ether.fi investigation needs an archive-capable Base mainnet endpoint.
Set `BASE_RPC_URL` only in the ignored `.env` file, then run:

```sh
npm run build
npm run scan
```

The scan is fixed to block `23487559` and the configured qualifying transaction.
A verified complete run produces one informational `contract_upgrade` alert,
complete evidence, a corroborated investigation, and no failures.
`npm run scan` executes the compiled `dist/cli/scan.js` entrypoint and therefore
requires `npm run build` after a fresh checkout. It does not load the
development-only `tsx` package. Use `npm run scan:dev` only for source-level
development.

Build and run the compiled production artifact:

```sh
npm run build
npm start
```

`npm start` runs `dist/server/main.js` with plain Node.js. Production startup
does not load `tsx`. `.nvmrc`, `packageManager`, and package engine metadata pin
the supported toolchain. The install preflight exits with a clear message on an
unsupported Node major version.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Sanitized service health |
| `GET` | `/api/config` | Public server-selected profile configuration |
| `POST` | `/api/scans` | Run the approved bounded scan |
| `GET` | `/api/scans/:scanId` | Read one in-memory scan result |
| `GET` | `/api/alerts` | List current in-memory alerts |
| `GET` | `/api/alerts/:alertId` | Read alert and evidence detail |
| `GET` | `/api/receipts/:receiptId` | Download a validated JSON receipt |

Run the active scan:

```sh
curl -X POST \
  -H 'content-type: application/json' \
  --data '{}' \
  http://localhost:3000/api/scans
```

Scan response semantics:

- HTTP 201 for a complete scan
- HTTP 200 with the structured result for a partial scan
- HTTP 502 for malformed upstream data or a wrong-chain RPC
- HTTP 503 for other upstream availability failures
- HTTP 429 when another scan is already active in the process
- HTTP 415 for missing or unsupported content type
- HTTP 400 for malformed JSON, invalid fields, or invalid approved bounds
- HTTP 413 for request bodies larger than 16 KB

Structured scan results and safe failures remain available in non-2xx scan
responses. Provider URLs, credentials, response bodies, and stack traces are
never included.

The public API permits one active scan per process and applies a fixed 30-second
total deadline. A deadline returns a structured `scan-deadline-timeout` failure
with HTTP 503 and aborts outstanding scanner, evidence, investigation, and HTTP
RPC work through one scan-owned `AbortController`. That failed attempt
atomically replaces artifacts with the same scan ID, and late completion has no
path back into the store. The process-wide lock remains held until the aborted
scan settles and cleanup finishes, so requests during cleanup receive HTTP 429.
A later request may start after cleanup. Existing bounded viem request timeouts
and retries remain unchanged.

## Failure handling

Watchtower verifies RPC chain ID `8453` before scanning. It categorizes DNS,
timeout, rate-limit, malformed-response, wrong-chain, unsupported-history, and
incomplete-evidence failures without exposing provider details.

Block, transaction, receipt, and nested receipt-log objects pass runtime
validation at the ChainReader boundary. Malformed candidate evidence becomes a
safe incomplete record or structured failure. Independent valid candidates
continue through the pipeline.

Complete, partial, and failed attempts atomically replace previous artifacts
with the same deterministic scan ID, so stale alerts or receipts cannot survive
a rescan.

## Current MVP limitations

- Only the three listed Base profiles are supported.
- Only the configured `Upgraded(address)` event is detected.
- The live API scans one server-selected profile and one approved historical
  range. The browser selector replays fixtures and cannot change scanner scope.
- There is no continuous monitoring, notification delivery, authentication,
  wallet access, transaction submission, database, multi-chain support, dynamic
  proxy discovery, or arbitrary RPC execution.
- Ownership changes, pause events, transfers, remote LayerZero peers, DVNs,
  executors, SyncPool operations, L1 backing paths, and broader governance
  claims are outside the current evidence boundary.
- Historical checks require an archive-capable provider. Pruned history,
  rate limits, timeouts, and provider outages can produce an incomplete result.
- The Aave fixture records implementation bytecode presence and a verified
  length of `22757` bytes, but no bytecode hash. The configured archive RPC
  hostname did not resolve during final provenance verification, so an earlier
  unsupported frontend-only hash was removed. Compound and ether.fi retain
  their independently recorded fixture hashes.
- Alerts and live receipts are held in memory and clear when the server restarts.
- No hosted public demo URL is currently available.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

GitHub Actions runs the same checks on Node 24 for pushes and pull requests. A
separate production job runs `npm ci --omit=dev`, rebuilds `dist/`, invokes the
compiled scan CLI against a non-routable placeholder and validates its safe
structured failure, starts the compiled server directly, requests
`GET /api/health`, and sends a graceful SIGTERM. CI does not require a live RPC
provider or secret.

The current release-hardening suite contains 147 tests covering all three
profiles, deterministic receipt integrity, API behavior, malformed RPC evidence,
scan cancellation and deadline cleanup, measured check timing, frontend states,
production configuration, runtime pinning, CI requirements, and failure
handling.

Verify the current public revision directly from the tracked remote:

```sh
git fetch origin
git rev-parse origin/main
```

Fixture provenance and detailed verified values are available in:

- [`fixtures/base/aave-v3-upgrade-41105890/`](fixtures/base/aave-v3-upgrade-41105890/)
- [`fixtures/base/compound-iii-usdc-upgrade-40235590/`](fixtures/base/compound-iii-usdc-upgrade-40235590/)
- [`fixtures/base/etherfi-weeth-oft-upgrade-23487559/`](fixtures/base/etherfi-weeth-oft-upgrade-23487559/)

## License

MIT. See LICENSE.
