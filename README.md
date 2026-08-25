# Watchtower

Watchtower is being developed as an evidence-backed Base incident monitoring
agent.

Watchtower provides a deterministic, read-only evidence pipeline and a
multi-profile investigation archive for verified Aave V3 Base Pool, Compound
III Base USDC Comet, and ether.fi Base weETH OFT proxy upgrades. The selected
live demo is ether.fi. The repository
contains validated configuration, strict event decoding, normalized records,
structured failures, an Express API, and a vanilla browser interface. It does
not contain continuous monitoring, notifications, authentication, wallet
access, a database, deployment infrastructure, or LLM integration.

## Start here

Before making changes:

1. Read `AGENTS.md`.
2. Read `.agent/TASK.md`, `.agent/STATUS.md`, `.agent/DECISIONS.md`, and `.agent/BLOCKERS.md`.
3. Inspect the Git status and history.
4. Work only within the approved task scope.
5. Validate the milestone, update `.agent/STATUS.md`, and commit it with a Conventional Commit message.

## Reproducible setup

Requirements:

- Node.js 24 or newer
- npm

From a clean clone, run:

```sh
npm --version
node --version
npm ci
cp .env.example .env
npm test
npm run typecheck
```

The verified environment used Node.js `v24.15.0` and npm `11.12.1`. `npm ci`
installs exactly from the committed lockfile, which is the dependency source of
truth.

Start the local server:

```sh
npm run dev
```

Open http://localhost:3000. The frontend immediately exposes the three
committed verified fixtures as a read-only archive. Selecting a profile replays
only its committed evidence in the browser. `Run active profile scan` is enabled
only for the server-selected ether.fi profile and requests the existing
approved one-block RPC scan.

Build and run the production artifact:

```sh
npm run build
npm start
```

`npm run build` compiles `src/` to the ignored `dist/` directory. `npm start`
runs `dist/server/main.js` with plain Node.js and does not load `tsx`. TypeScript
and its declaration packages are production build dependencies so the exact
clean-checkout sequence below also works after omitting development packages.
`tsx` and Vitest remain development-only.

## Opt-in live demo scan

The selected ether.fi profile requires an archive-capable Base RPC because all
six investigation checks use fixed historical block tags. Copy `.env.example`
to `.env`, then replace its example endpoint with the configured Alchemy Base
archive URL. Keep that credentialed URL only in the ignored `.env` file. Never
place it in source, fixtures, logs, or shared command output.

Run the fixed historical scan:

```sh
npm run scan
```

The command scans only block `23487559`. It writes the structured result to
standard output and exits with a nonzero status if the scan fails. The endpoint
is not embedded in application code, and no scan runs unless this command is
invoked.

Expected verified result:

- scan status: `complete`
- alert ID: `alert_ab98e3ce908cbf4261b579a876f24f230e33dab850fa117a563d301be636e74a`
- severity: `informational`
- severity rule: `target-is-approved`
- evidence status: `complete`
- alerts: `1`
- failures: `0`
- receipt ID: `receipt_af9ac18199f550c4d6ccf64a16334dd03afbbe3a3bf06c705347e16684bd64b5`

The earlier 2026-08-23 timings describe the Aave public-endpoint profile. On
2026-08-24, the selected Compound and ether.fi values were independently
reproduced through the configured Alchemy archive endpoint. These are
single-run observations, not latency guarantees. Provider load and network
conditions can change them.

## API

The server exposes:

- `GET /api/health`
- `GET /api/config`, containing sanitized public configuration only
- `POST /api/scans`, accepting only optional decimal `fromBlock` and `toBlock`
- `GET /api/scans/:scanId`
- `GET /api/alerts`
- `GET /api/alerts/:alertId`
- `GET /api/receipts/:receiptId`, returning the validated replay receipt as a
  JSON attachment

Run the approved scan directly through the API:

```sh
curl -X POST -H 'content-type: application/json' --data '{}' http://localhost:3000/api/scans
```

Verify the documented local server without changing scan scope:

```sh
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3000/api/config
curl --fail -X POST -H 'content-type: application/json' --data '{}' http://localhost:3000/api/scans
curl --fail http://localhost:3000/api/alerts
```

The 2026-08-25 local check returned HTTP 200 for health, sanitized
configuration, the dashboard, and the static three-profile archive module.
Automated API tests continue to cover live scan, alert detail, receipt download,
failure replacement, request validation, and security headers.

Scan requests require `Content-Type: application/json` and a JSON object. The
only accepted properties are optional decimal-string `fromBlock` and `toBlock`
values. Missing or unsupported `Content-Type` values return HTTP 415. Malformed
JSON or invalid JSON fields return HTTP 400. Bodies larger than 16 KB return
HTTP 413. These errors use safe JSON codes and do not start an RPC scan.

Complete scans return HTTP 201. Partial scans return HTTP 200 with the
structured partial result. Failed scans return their structured scan body with
HTTP 502 when the upstream response is malformed or from the wrong chain, and
HTTP 503 for unavailable, DNS, timeout, rate-limit, unsupported-history, or
confirmation failures. A non-2xx scan response still contains the deterministic
scan ID, status, artifacts retained by that attempt, and safe failure records.

Scans, alerts, and evidence exist only in process memory and are cleared when
the server restarts. Repeating the scan recreates the same deterministic IDs.

## Supported target profiles

Watchtower has a closed registry containing only these preconfigured Base
profiles:

- Aave V3 Base Pool
- Compound III Base USDC Comet
- ether.fi Base weETH OFT

`config/target.json` selects the ether.fi profile by ID. The dashboard and CLI
therefore scan Base mainnet block `23487559` for one event from one verified
transaction:

- `Upgraded(address)` from the configured ether.fi Base weETH OFT proxy

The public configuration, normalized alert, and dashboard use the single human
classification label `Contract upgrade`. The machine identifiers remain
`contract_upgrade` for the incident class and `proxy_upgraded` for the event
type.

All three fixtures contain selected logs and record their BaseScan and official
protocol sources. Compound and ether.fi also record six values independently
reproduced through the configured Alchemy Base archive RPC.

Known unsupported event types and cases:

- ownership and administrative changes
- pause and unpause events
- ERC-20 or native-asset large movements
- `PoolUpdated(address,address)` and other related-contract events
- arbitrary addresses, signatures, ABIs, custom events, and proxy patterns
- dynamic project discovery, transaction tracing, and fiat-value conversion

These exclusions are deliberate. Every profile fixes one proxy, one qualifying
transaction, one block, one event signature, and one explicit investigation
plan. The API cannot select a profile or override its address, calls, topic, or
blocks.

## Multi-profile investigation workspace

The target selector is a frontend archive filter, not a scanner input. It lists
exactly the three closed registry profiles and never submits a profile ID,
address, RPC URL, call, event signature, plan, or block to the API. The server
continues to select one active profile from `config/target.json`.

For each committed fixture, the archive shows the real protocol, upgrade event,
block, UTC timestamp, corroborated disposition, six-check count, deterministic
receipt ID, and replay action. Replaying a fixture shows:

- the triggering event and selected deterministic plan
- the six-stage investigation trace
- each RPC method, exact block tag, expected value, actual value, and assertion
  status
- visible failures, unsupported checks, and evidence limitations
- BaseScan links for the transaction, block, emitter, implementation, and named
  profile addresses
- a downloadable JSON receipt that passes the same strict receipt schema and
  canonical hash validation as live receipts

An in-memory live result replaces the active profile's fixture view only after
a scan returns evidence. The source badge always states `Live RPC result` or
`Verified fixture`. Selecting Aave or Compound keeps the live scan control
disabled because the browser cannot change the server-selected profile.

## Evidence pipeline

The synchronous scanner:

1. Resolves and validates the closed server-selected profile and requested bounds.
2. Reads the RPC chain ID and requires Base mainnet chain ID `8453`.
3. Checks the configured confirmation count.
4. Requests logs using the selected profile's approved proxy and upgrade topic.
5. Loads the committed ABI and verifies that it matches the configured topic
   and strict runtime decoder.
6. Preserves valid logs when another item in the same RPC response is malformed,
   while recording the malformed item as a visible partial-scan failure.
7. Strictly decodes `Upgraded(address)`.
8. Retrieves the block, transaction, and receipt once per evidence key. Strict
   runtime schemas validate those objects and every nested receipt log at the
   ChainReader boundary.
9. Requires the configured known transaction to produce complete qualifying
   event evidence before reporting `complete`.
10. Builds normalized evidence and applies the fixed severity policy.

Malformed evidence becomes incomplete with safe candidate coordinates and no
raw provider data. Evidence construction is isolated per candidate. If one
candidate cannot be normalized or its receipt cannot be constructed, the
scanner continues with independent valid candidates from the same bounded
response.
11. Uses content-derived scan and alert IDs to prevent duplicates.

RPC, filter, decoding, and evidence failures remain visible in the JSON result.
An alert with missing block, transaction, receipt, or receipt-log evidence is
marked `incomplete` rather than discarded.

## Live evidence verification

The milestone 4 audit compared the complete record with live Base JSON-RPC data
through the public endpoint. All 26 checks passed.

| Evidence group | Verified value |
| --- | --- |
| Network | Base mainnet, chain ID `8453` |
| Confirmation check | More than 20 confirmations at verification time |
| Block | `41105890`, hash `0x3f8b9a19d39bdf97178f6f7e7117138ec5cb7c5fe292afcac914a250568428ff`, timestamp `2026-01-21T13:12:07.000Z` |
| Transaction | `0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a` |
| Sender | `0xd7e21e6debb75ceb4fc9d73c09ea48625984b959` |
| Recipient | `0xe226d5acae908252cca3f6cefa577527650a9e1e` |
| Receipt | success, transaction index `122`, matching block hash |
| Log | index `641`, emitting Pool proxy, matching receipt log |
| Event topic | `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b` |
| Decoded implementation | `0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4` |
| Severity | `informational` from `target-is-approved` |
| Evidence errors | none |

The topic is the hash of `Upgraded(address)`. The indexed implementation topic
decodes to the configured approved implementation. Both the emitting proxy and
implementation returned deployed bytecode. Configuration-derived fields, roles,
severity inputs, deterministic IDs, summaries, and limitations were checked
against the registered Aave profile and the automated tests. The selected
profile is now ether.fi, while the Aave fixture remains reproducible by its
closed registry ID.

Every explorer link displayed for the complete alert returned HTTP 200:

- [transaction](https://basescan.org/tx/0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a)
- [block](https://basescan.org/block/41105890)
- [emitting Pool proxy](https://basescan.org/address/0xa238dd80c259a72e81d7e4664a9801593f98d1c5)
- [decoded implementation](https://basescan.org/address/0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4)

### Compound III Base USDC Comet verification

On 2026-08-24, the configured Alchemy Base archive RPC reproduced the selected
Compound profile without using current-state reads. The RPC URL and credential
were not printed or committed.

| Evidence group | Verified value |
| --- | --- |
| Network | Base mainnet, chain ID `8453` |
| Block | `40235590`, hash `0x87b4a904a696c3620e48f69aca523712b20f87796b6124dc3bf1c60e059caf76`, timestamp `2026-01-01T09:42:07.000Z` |
| Transaction | `0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4` |
| Sender and recipient | `0x9f771c534f12d711a91f1ad5bb8b4941b5252768` to `0x18281dfc4d00905da1aaa6731414eaba843c468a` |
| Receipt and log | success, transaction index `42`, `Upgraded(address)` at log index `270` |
| Implementation at N-1 | `0xd84933745943df8edc45ff0f0ef7bd55324a22b6` from the EIP-1967 slot at block `40235589` |
| Implementation at N | `0x89e9b098bb0e3d09f4288fb2b9632b4dcb40bbf6` from the EIP-1967 slot at block `40235590` |
| Implementation bytecode at N | present, `18,599` bytes, keccak256 `0x7ad880dc9e6aeb907ddcab4b15beede0c5e85565558aa3277fac2fbbbe137ac8` |
| `governor()` at N-1 and N | `0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02` |
| `baseToken()` at N | Base USDC, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

The fixed checks corroborate the proxy implementation transition and the
Comet market identity. They do not establish governance intent, proposal
correctness, complete configuration safety, or the safety of related contracts.
Archive pruning, timeouts, rate limits, and unavailable historical calls produce
an incomplete investigation. Watchtower never substitutes a current-state read.

Direct sources:

- [qualifying transaction](https://basescan.org/tx/0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4)
- [block 40235590](https://basescan.org/block/40235590)
- [Comet proxy](https://basescan.org/address/0xb125E6687d4313864e53df431d5425969c15Eb2F)
- [new implementation](https://basescan.org/address/0x89e9b098bb0e3d09f4288fb2b9632b4dcb40bbf6)
- [official Compound Base USDC deployment](https://github.com/compound-finance/comet/blob/main/deployments/base/usdc/roots.json)

### ether.fi Base weETH OFT verification

On 2026-08-24, the configured Alchemy Base archive RPC reproduced the selected
ether.fi profile using only the exact historical blocks. The RPC URL and
credential were not committed.

| Evidence group | Verified value |
| --- | --- |
| Network | Base mainnet, chain ID `8453` |
| Block | `23487559`, hash `0xeab850b0bf771ea85a8c36a41e61d731656f0dba0695f18f70542068976f0a8d`, timestamp `2024-12-09T17:14:25.000Z` |
| Transaction | `0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2` |
| Sender and recipient | `0x620d7e459cffcdc56a874536dc19147de801a4a1` to `0xf9d64d54d32ee2bdceaabfa60c4c438e224427d0` |
| Receipt and log | success, transaction index `93`, `Upgraded(address)` at log index `190` |
| Implementation at N-1 | `0x20ee00f43ef299dba82ba6fef537756dabe38cc7` from the EIP-1967 slot at block `23487558` |
| Implementation at N | `0xde8a2c33655aca88f258988ed74d1511876343d1` from the EIP-1967 slot at block `23487559` |
| Implementation bytecode at N | present, `17,594` bytes, keccak256 `0x7f8bf0bedf0194598158e5b9d5510568e9d30a02b3f8e80d0acf15bf46546fb4` |
| `endpoint()` at N | LayerZero Endpoint V2, `0x1a44076050125825900e736c501f859c50fe728c` |
| `token()` at N | configured weETH OFT proxy, `0x04c0599ae5a44757c0af6f9ec3b93da8976c150a` |
| `sharedDecimals()` at N | `6` |

The six checks corroborate only the Base-side proxy implementation transition,
deployed implementation code, and configured OFT identity values. They do not
establish the safety of remote peers, DVNs, executors, SyncPool operations,
Layer 1 backing paths, governance intent, or other contracts. Pruned history,
timeouts, rate limits, and unavailable historical calls produce an incomplete
investigation. Watchtower never substitutes a current-state read.

Direct sources:

- [qualifying transaction](https://basescan.org/tx/0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2)
- [block 23487559](https://basescan.org/block/23487559)
- [weETH OFT proxy](https://basescan.org/address/0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A)
- [new implementation](https://basescan.org/address/0xde8A2C33655ACA88f258988ED74D1511876343D1)
- [official ether.fi cross-chain repository](https://github.com/etherfi-protocol/weETH-cross-chain)

## RPC behavior and limitations

The selected ether.fi investigation requires an archive-capable Base endpoint
for its fixed N-1 and N storage and contract reads. The configured Alchemy Base
archive RPC reproduced all six checks. Watchtower also requires historical
`eth_getLogs`, block, transaction, receipt, and latest-block access. Its viem
HTTP transport uses a 10-second request timeout, two retries, and a 250 ms retry
delay.

The endpoint is a shared public service with no availability or latency promise
from this repository. It may rate limit, time out, or become temporarily
unavailable. Watchtower preserves safe structured categories for DNS failures,
timeouts, rate limits, malformed responses, wrong-chain endpoints, and
incomplete evidence. Provider URLs, raw provider messages, and stack traces are
not returned through scan results. Use a credentialed provider only through the
ignored local `.env` file.

During the 2026-08-24 ether.fi validation, the machine's default resolver
returned `ENOTFOUND` for two plain `npm run scan` attempts. A temporary
DNS-only preload used the public address returned by DNS-over-HTTPS and the
unchanged configured Alchemy hostname. The bounded scan then completed. This is
a local resolver limitation, not a provider substitution or repository setting.

## Partial and failed scans

Automated tests verify all three scan states:

- `complete`: the approved log and all evidence are available
- `partial`: a bounded chunk succeeds but strict decoding or evidence retrieval
  fails, the known event is absent, or the known transaction lacks complete
  evidence; supported alerts remain visible and incomplete evidence explains gaps
- `failed`: validation, latest-block access, or every bounded log chunk fails;
  alerts and evidence are empty and structured failures remain visible

A failed chain-ID or scan RPC request produces `status: failed`, a safe
categorized failure, no alerts, and no evidence. The CLI exits with status 1
for a failed scan. A server listen error is also reported with a safe startup
message and a nonzero process exit status.

## Investigation output

Each alert separates:

- observed facts copied from its evidence record
- deterministic interpretation tied to the displayed severity rule
- limitations that prevent the address comparison from being read as a claim
  about identity, intent, causality, or implementation safety

The frontend checks `/api/health` before presenting its service indicator. It
shows the classification, severity rule, evidence status, transaction, sender,
recipient, receipt, block, UTC-labeled timestamp, log index, topic zero, raw
topics, detector inputs, severity inputs, configured address roles, decoded
implementation, and direct BaseScan links. A six-stage trace shows the observed
event, selected versioned plan, bounded historical state reads, implementation
check, protocol identity check, and replay receipt. Failed, unsupported, and
plan-skipped checks remain visible. The receipt can be downloaded as validated
JSON. Stale alert detail is cleared when the in-memory alert list becomes empty
or replaces the selected alert. Scan failures and incomplete-evidence errors
remain visible rather than being replaced by a generated explanation.

Each replay receipt uses a deterministic SHA-256 ID derived from a canonical
payload containing exactly `schemaVersion`, `trigger`, `plan`, `checks`,
`errors`, `limitations`, `finalDisposition`, and `explorerLinks`. The
`receiptId` is excluded from that payload. Object keys are serialized in sorted
order while array order is preserved. Receipt creation and schema validation
use the same canonicalization, and validation independently recomputes the ID.
Exact 20-byte Ethereum address values are normalized to one EIP-55 form before
comparison and hashing. Equivalent lowercase and checksum addresses therefore
produce the same receipt ID. Hashes, topics, calldata, URLs, labels, and other
non-address strings are not changed by address normalization.

Runtime schema refinements also reject inconsistent check status, result,
assertion, and failure combinations. They derive the required final disposition
from required check outcomes and require receipt trigger, plan, checks,
disposition, and explorer links to match the containing evidence and
investigation records.

CLI failures preserve their source boundary. Configuration schema failures use
`configuration-validation-failed`, other runtime result schema failures use
`runtime-validation-failed`, receipt or evidence consistency failures use
`evidence-consistency-failed`, and uncaught RPC failures use `rpc-failed` with
only a safe category. These outputs omit stack traces, provider URLs,
credentials, and raw provider bodies.

## Configuration

The complete non-secret definitions live in the closed TypeScript profile
registry. `config/target.json` contains only a registered profile ID. The server
and CLI read `BASE_RPC_URL` from a local `.env` file and default
`WATCHTOWER_CONFIG_PATH` to the committed selector file. Unknown IDs and extra
selection fields are rejected before RPC access.

Keep real values in ignored local environment files. Never commit secrets or
place RPC credentials in target configuration or fixtures.

`.env` and `.env.*` are ignored, while `.env.example` remains tracked. The
private handoff directory `.agent/private/` is also ignored. The public API
configuration is assembled from safe fields and does not expose `BASE_RPC_URL`.

## Current verification commands

Use these commands for a clean checkout and current verification:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run scan
npm audit --audit-level=moderate
npm run dev
```

For a production-only checkout, use:

```sh
npm ci --omit=dev
npm run build
npm start
```

After startup, request `GET /api/health`. Send `SIGTERM` or `SIGINT` for a
graceful shutdown after in-flight HTTP requests have closed.

The 2026-08-24 address-regression verification reported 13 test files and 87
tests passed, TypeScript reported no errors, and npm audit reported zero
vulnerabilities. Three attempts to run the configured Alchemy archive-RPC scan
stopped safely at chain verification with `chain-id-rpc-dns`. A direct lookup
of Alchemy's public Base hostname also returned `ENOTFOUND`. No alternate
provider was substituted during that verification, so live success was blocked
at that time.

The 2026-08-24 closed-profile registry verification reported 13 test files and
92 tests passed. `npm run typecheck` reported no TypeScript errors.

The 2026-08-24 Compound implementation verification reported 14 test files and
101 tests passed. `npm run typecheck` reported no TypeScript errors. Plain
`npm run scan` selected the Compound profile but returned the safe
`chain-id-rpc-dns` failure because the machine resolver still returned
`ENOTFOUND`. Running the same scanner through a temporary local DNS bridge to
the unchanged configured Alchemy endpoint completed with one informational
alert, one complete evidence record, zero failures, a corroborated disposition,
and deterministic receipt
`receipt_9e87dba3784fba97a3c51f81bf5d34e878342113eeeb65e3a83f07a4ae07327f`.

The 2026-08-25 multi-profile frontend verification reported 15 test files and
118 tests passed. TypeScript and JavaScript parsing passed. All three committed
fixture receipts passed strict schema and canonical ID validation. Local HTTP
checks passed for health, sanitized configuration, the dashboard, and the
three-profile archive asset. A browser session was unavailable in this
environment, so rendered screenshot inspection remains an explicit validation
limitation rather than a claimed pass.

The 2026-08-25 release-hardening verification reported 15 test files and 128
tests passed. Typecheck, compiled build, diff checks, and tracked secret checks
passed. npm audit reported zero vulnerabilities. A clean candidate checkout
passed `npm ci --omit=dev` and `npm run build`, then `npm start` served a healthy
ether.fi response. The compiled entrypoint handled SIGTERM with exit status 0.

The tracked public branch was `origin/main` at
`db7d9995d1b625bff9744402f5414ada80ce9512` before this batch. The three
release-hardening commits remain local until explicitly pushed and verified
from an unauthenticated public clone. Public parity for this batch is not
claimed.
