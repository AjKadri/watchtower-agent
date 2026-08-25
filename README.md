# Watchtower

Watchtower is a read-only investigation tool for contract upgrades on Base. It
turns a configured `Upgraded(address)` event into a bounded historical
investigation, shows the evidence behind each conclusion, and issues a
deterministic replay receipt.

It is built for protocol security teams, incident responders, auditors, and
researchers who need to verify what changed without trusting a generated
narrative.

- [Reproducible demo](#run-the-demo)
- [GitHub repository](https://github.com/AjKadri/watchtower-agent)
- [Aave fixture transaction](https://basescan.org/tx/0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a)
- [Compound fixture transaction](https://basescan.org/tx/0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4)
- [ether.fi fixture transaction](https://basescan.org/tx/0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2)

A hosted public demo is not published yet. The repository includes a complete
local demo and three committed, verified investigation fixtures.

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

## Demo flow

1. Open the investigation archive and select one of the three verified profiles.
2. Replay its committed upgrade investigation without making an RPC request.
3. Inspect the six-stage trace, expected and observed values, exact block tags,
   RPC methods, assertion states, limitations, and BaseScan sources.
4. Download the validated JSON receipt and verify its deterministic ID.
5. With an archive-capable Base RPC configured, run the active ether.fi scan and
   compare the live result with the committed fixture.

The interface labels every result as `Verified fixture` or `Live RPC result`.
Failed, skipped, unsupported, and incomplete checks remain visible.

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
  status, and safe failure
- the final `corroborated`, `contradicted`, or `incomplete` disposition
- direct explorer links

The receipt ID is a SHA-256 hash of a canonical payload that excludes the ID
itself. Validation recomputes that hash and checks consistency across the
trigger, evidence, plan, checks, disposition, and links. Equivalent Ethereum
address casing produces the same canonical receipt ID.

These receipts prove the recorded observations and deterministic assertions.
They do not prove upgrade intent, governance legitimacy, implementation safety,
remote cross-chain safety, or the security of related contracts.

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
  evidence details, failures, and receipt downloads.
- Process memory is sufficient because the bounded scans and deterministic IDs
  reproduce the same records from Base. Committed fixtures provide the public
  archive.

## Run the demo

Requirements:

- Node.js 24 or newer
- npm

```sh
git clone https://github.com/AjKadri/watchtower-agent.git
cd watchtower-agent
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
npm run scan
```

The scan is fixed to block `23487559` and the configured qualifying transaction.
A verified complete run produces one informational `contract_upgrade` alert,
complete evidence, a corroborated investigation, and no failures.

Build and run the compiled production artifact:

```sh
npm run build
npm start
```

`npm start` runs `dist/server/main.js` with plain Node.js. Production startup
does not load `tsx`.

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
- HTTP 415 for missing or unsupported content type
- HTTP 400 for malformed JSON, invalid fields, or invalid approved bounds
- HTTP 413 for request bodies larger than 16 KB

Structured scan results and safe failures remain available in non-2xx scan
responses. Provider URLs, credentials, response bodies, and stack traces are
never included.

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
- Alerts and live receipts are held in memory and clear when the server restarts.
- No hosted public demo URL is currently available.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

The current release-hardening suite contains 128 tests covering all three
profiles, deterministic receipt integrity, API behavior, malformed RPC evidence,
frontend states, production configuration, and failure handling.

Fixture provenance and detailed verified values are available in:

- [`fixtures/base/aave-v3-upgrade-41105890/`](fixtures/base/aave-v3-upgrade-41105890/)
- [`fixtures/base/compound-iii-usdc-upgrade-40235590/`](fixtures/base/compound-iii-usdc-upgrade-40235590/)
- [`fixtures/base/etherfi-weeth-oft-upgrade-23487559/`](fixtures/base/etherfi-weeth-oft-upgrade-23487559/)
