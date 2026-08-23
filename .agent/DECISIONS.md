# Decisions

## 2026-08-22: Keep initialization technology-neutral

Status: Accepted

The repository starts with documentation and collaboration workflow files only. No language, framework, package manager, service, data source, hosting provider, or infrastructure is selected until an approved product task requires a choice.

Reason: The current product boundary is intentionally broad, so an early technical commitment would create unsupported scope.

## 2026-08-22: Use repository handoff files as shared state

Status: Accepted

Agents will use `AGENTS.md`, `.agent/TASK.md`, `.agent/STATUS.md`, `.agent/DECISIONS.md`, `.agent/BLOCKERS.md`, and Git history as the shared source of truth.

Reason: Small, versioned handoffs make progress, decisions, validation, and blockers visible across agents.

## 2026-08-22: Use a single-process TypeScript stack

Status: Accepted

Watchtower will use:

- Node.js 24 LTS
- TypeScript with strict type checking
- npm
- Express 5 for the API and static dashboard server
- viem with a public client for read-only Base RPC access
- Zod for environment, target configuration, and response validation
- Vitest for unit and integration tests
- vanilla HTML, CSS, and browser JavaScript for the dashboard

The repository will use one `package.json` and one long-running Node process. React, Next.js, a database, an ORM, queues, Docker, authentication, WebSockets, and an LLM are excluded from this MVP.

Local development will use `npm run dev`. Required verification commands will be `npm test`, `npm run typecheck`, and `npm run scan`.

Reason: This is the smallest stack that supports private server-side RPC configuration, strict event processing, automated tests, and a usable judge-facing dashboard without separate services.

## 2026-08-22: Separate the evidence pipeline from HTTP delivery

Status: Accepted

The scanner, decoder, evidence collector, and severity engine will be plain TypeScript modules with no dependency on Express. Express will expose the modules through a small API and serve the static dashboard from `public/`.

The initial API contract will be:

- `GET /api/health`
- `GET /api/config` for sanitized public configuration
- `POST /api/scans` for one bounded scan
- `GET /api/scans/:scanId`
- `GET /api/alerts`
- `GET /api/alerts/:alertId`

The browser may request block overrides only within the approved configured demo range. It may not provide an RPC URL, arbitrary address, ABI, or event signature.

Reason: A framework-independent evidence pipeline is easier to test, safer to reuse from the demo CLI, and less likely to mix private configuration with browser code.

## 2026-08-22: Use environment variables plus one validated target file

Status: Accepted

Secrets and machine-local settings will use `.env`:

- `BASE_RPC_URL`
- `WATCHTOWER_CONFIG_PATH`, defaulting to `config/target.json`
- `PORT`, defaulting to `3000`

The committed `config/target.json` file will contain the non-secret network, target, scan range, detector, transfer threshold, and policy settings. Zod will validate both sources before the server or CLI starts.

Block numbers and onchain quantities will be decimal strings in JSON. Ethereum addresses will be validated and normalized before comparison. Approved ABI event fragments will be committed with the detector implementation. Configuration will reference known detector IDs rather than accept arbitrary ABI definitions.

Reason: This keeps the RPC credential server-side while making the complete demo target and policy reviewable and reproducible.

## 2026-08-22: Use normalized alert and evidence records

Status: Accepted

Each alert will contain:

- a deterministic ID derived from chain ID, transaction hash, log index, and detector ID
- scan ID and target ID
- incident class and normalized event type
- severity and severity rule ID
- factual title and evidence-bounded summary
- block-derived observation timestamp
- evidence status and evidence ID
- direct source links

Each evidence record will contain:

- network name and chain ID
- block number, hash, and timestamp
- transaction hash, sender, recipient, and receipt status
- log index, emitter, topic zero, and raw topics
- exact event signature and decoded arguments
- relevant addresses and their configured roles
- detector inputs, thresholds, and observed quantities
- severity-rule inputs and result
- atomic observed facts
- explorer source links
- retrieval or decoding errors
- `complete` or `incomplete` status

All bigint values will be serialized as decimal strings. Explanations will separate observed facts from interpretation and will not assert identities, intent, causality, or risk beyond the stored evidence and fired severity rule.

Reason: A normalized contract makes alerts independently verifiable and keeps retry, display, and test behavior deterministic.

## 2026-08-22: Use a synchronous bounded historical scan

Status: Accepted

One scan will:

1. Validate the configuration and requested bounds.
2. Confirm the end block satisfies the configured confirmation requirement.
3. Reject reversed or oversized ranges.
4. Split the range into configurable chunks.
5. Query only approved addresses and topic-zero signatures.
6. Strictly decode supported logs.
7. Sort logs by block number, transaction index, and log index.
8. Deduplicate using the deterministic alert ID.
9. Fetch each required block and receipt once with bounded concurrency.
10. Build evidence, apply severity rules, and store the result in memory.

The initial large-movement detector will support ERC-20 `Transfer` events only. Native-asset movement, transaction tracing, fiat conversion, dynamic ABI lookup, and arbitrary custom events require a later decision.

Reason: A bounded synchronous scan is reproducible, easy to demonstrate, and avoids scheduling or background-worker infrastructure. ERC-20 logs provide direct evidence, while native movement would require a materially broader transaction or trace design.

## 2026-08-22: Keep severity deterministic

Status: Accepted

Severity rules will run in a fixed order and record their rule ID, inputs, address comparisons, thresholds, boolean conditions, and result.

The approved model is:

- `high`: an authority or implementation changes to an address explicitly outside the approved policy, or a transfer meets the configured critical threshold and reaches an unapproved recipient
- `suspicious`: an ownership, administration, upgrade, or pause event falls outside an approved expected path, or a transfer meets the standard threshold
- `informational`: a supported event matches the approved actors and destinations, including an expected administrative operation or unpause

Unknown intent will not be labeled malicious. An LLM will not assign severity.

Reason: Deterministic classification is testable, reproducible, explainable, and tied directly to approved policy inputs.

## 2026-08-22: Surface partial results and structured failures

Status: Accepted

Invalid configuration will prevent startup. Invalid scan input will return a client error. RPC timeouts, rate limits, and transient server failures will receive capped retries with bounded concurrency.

Failed chunks, malformed supported logs, missing blocks or receipts, and incomplete evidence will remain visible in structured scan results. A scan may be `complete`, `partial`, or `failed`. Secrets, stack traces, and the RPC URL will not be returned to the browser or written to normal logs.

Reason: Silent gaps would undermine the evidence claim and could make an incomplete scan look authoritative.

## 2026-08-22: Keep alerts in memory for the MVP

Status: Accepted

Alerts and scan results will live in process memory and will be cleared on restart. The approved historical scan must recreate the same alerts from Base using deterministic IDs.

Persistent storage will be reconsidered only if the scope adds continuous monitoring, multiple users, acknowledgements, notification history, or scans that are too expensive to reproduce.

Reason: Base is the durable evidence source. A database would add migrations, deployment state, and cleanup behavior without improving the bounded single-operator demo.

## 2026-08-22: Monitor a verified Aave V3 Base core upgrade

Status: Accepted

Milestone 1 resolves the target-specific implementation gates as follows:

1. The network is Base mainnet with chain ID `8453`.
2. The primary contract is the Aave V3 Base Pool proxy at
   `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`. The only related contract in
   this profile is its PoolAddressesProvider at
   `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D`.
3. The demo range is the single block `41105890`. The qualifying transaction is
   `0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a`.
4. The only supported signatures are the standard proxy event
   `Upgraded(address)` emitted by the configured Pool proxy and the
   target-specific `PoolUpdated(address,address)` emitted by the configured
   PoolAddressesProvider. The exact ABI fragments, topic-zero values, emitting
   addresses, and indexed arguments are committed with the target profile.
5. Large-movement detection is excluded from this target profile. The verified
   transaction does not contain a representative large-transfer event, so no
   ERC-20 asset, watched address, or threshold is invented. Pause and unpause
   events are excluded for the same evidence reason.
6. Severity rules run in this order: a zero decoded target is `high`, a nonzero
   decoded target outside the approved target list is `suspicious`, and an
   approved decoded target is `informational`. The verified transaction is the
   informational example because both decoded new targets are the approved
   implementation `0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4`. High and
   suspicious examples are explicitly labeled counterfactual policy cases and
   are not presented as historical incidents.
7. The previously approved single-process TypeScript stack and future
   `npm run dev` command remain unchanged. Milestone 1 has no runnable
   application. Its commands are `npm test` and `npm run typecheck`.

The fixture is a curated subset of two verified transaction logs rather than a
complete RPC receipt. It records its BaseScan and official Aave address-book
sources. No other contracts or event types are implied by this decision.

Reason: A one-block, one-transaction target makes the first evidence boundary
small and independently checkable. Narrowing unsupported incident classes is
more reliable than constructing a demo around events that the selected history
does not contain.

## 2026-08-22: Narrow milestone 2 to the Pool proxy upgrade event

Status: Accepted

Milestone 2 supersedes the earlier runtime approval for the related
PoolAddressesProvider and its `PoolUpdated(address,address)` event. The executable
target profile now contains only:

- the Aave V3 Base Pool proxy at
  `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- Base mainnet block `41105890`
- `Upgraded(address)` with topic zero
  `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b`
- approved implementation
  `0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4`

The configuration schema fixes these values and rejects related contracts,
additional detectors, arbitrary topics, and broader block ranges. Ownership,
administrative, pause, unpause, and large-movement detection are excluded.

The scanner uses a viem public client through the required `BASE_RPC_URL`. The
CLI is opt-in through `npm run scan`, performs no writes, and outputs one
structured scan result. It does not retain results between processes.

Reason: The milestone request explicitly limits implementation to the verified
Aave Pool upgrade fixture. Removing the previously documented custom ownership
event keeps the runnable evidence claim aligned with that narrower instruction.

## 2026-08-22: Keep investigation output evidence-bounded

Status: Accepted

Each normalized alert now contains an investigation object with three separate
parts:

- `observedFacts`, copied from the verified evidence record
- `interpretation`, generated from the recorded deterministic severity rule
- `limitations`, which state that address comparison does not establish identity,
  intent, causality, or implementation safety

Incomplete evidence adds a further limitation and remains visible in the alert,
evidence record, scan failures, API, and dashboard. No LLM generates or rewrites
the investigation.

The Express API uses one process-local store. `POST /api/scans` runs the existing
synchronous scanner and replaces records with the same deterministic IDs. Scan
requests accept only optional decimal `fromBlock` and `toBlock` values. The
pipeline still enforces the approved one-block boundary. Public configuration is
assembled field by field and never includes the RPC URL or environment values.

Reason: Separating facts from rule-based interpretation keeps every displayed
claim traceable to evidence while the in-memory API remains sufficient for the
single-operator historical demo.

## 2026-08-23: Use an operational SOC console presentation

Status: Accepted

The dashboard uses a dense investigation-console layout with a compact command
bar, active detection profile, session alert queue, deterministic signal strip,
event path, and source-linked evidence ledger. Status color is reserved for
service health, scan state, severity, evidence completeness, and failures.

The interface does not add live-monitoring claims, fabricated metrics, extra
detectors, or controls that imply write access. It presents the existing bounded
historical scan and process-local data model as they are.

Reason: The evidence workflow should read like an analyst tool, while every
visible capability remains accurate to the approved MVP scope.

## 2026-08-23: Require live chain and known-event proof for completion

Status: Accepted

A scan may be `complete` only when the RPC reports chain ID `8453` and every
configured known transaction produces a strictly decoded qualifying
`Upgraded(address)` event with complete evidence. A successful empty log query,
a log set that omits the known transaction, or incomplete evidence for that
transaction produces a structured non-complete result.

When a result replaces an existing deterministic scan ID, the in-memory store
removes that scan's previous alert and evidence indexes before saving the new
attempt. A failed or partial retry cannot expose stale artifacts as current.

Reason: The fixed demo is reproducible only if success proves the expected
historical incident on the expected chain and every API view represents the
latest attempt consistently.

## 2026-08-24: Approve a bounded upgrade investigation

Status: Accepted

The investigation provider is the Alchemy Base Mainnet archive RPC supplied
only through the server-side `BASE_RPC_URL` environment variable. Its URL and
credentials must not be committed, returned through APIs, or written to normal
logs.

The investigation is limited to the one configured Aave V3 Base Pool proxy and
is triggered only by the approved `Upgraded(address)` event. It may inspect only
the verified historical blocks:

- N-1: Base block `41105889`
- N: Base block `41105890`

The required investigation checks are:

1. Read the EIP-1967 implementation slot at N-1 and N.
2. Read the decoded implementation bytecode at N.
3. Call the configured Aave PoolAddressesProvider `getPool()` function at N.

The optional corroborating check is `POOL_REVISION()` at N-1 and N. Its result,
absence, failure, or lack of support must not control incident severity, the
deterministic event classification, or the final investigation disposition.

The final investigation disposition is one of:

- `corroborated`: every required check succeeds and agrees with the approved
  event, target, implementation transition, and deployed-code expectation.
- `contradicted`: a required check succeeds but conflicts with the approved
  event or configured target evidence.
- `incomplete`: a required check fails, is unsupported, or cannot be verified.

The verified fixture values are:

- implementation before: `0x79ab8fc5ba13daf37b4e978a543286bc2a16508c`
- implementation after: `0xdb578d67a83e94de73c9e0c14280f804f6c1c3e4`
- implementation bytecode at N: present, `22,757` bytes
- `getPool()` at N: the configured Pool proxy
- `POOL_REVISION()` at N-1: `9`
- `POOL_REVISION()` at N: `10`

The investigation remains read-only. Wallet access, transactions, continuous
monitoring, extra targets, notifications, authentication, unrestricted tool
execution, and any expansion beyond the approved target and blocks remain out
of scope.

Reason: The archive capability spike verified historical storage, code, and
contract calls against the fixed fixture. A bounded deterministic investigation
can now corroborate required onchain facts without changing detector scope or
allowing optional revision metadata to affect classification.
