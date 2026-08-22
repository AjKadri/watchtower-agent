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

## Pending target-specific implementation gates

Status: Pending

Application implementation remains blocked until the following facts are selected, verified against Base, and recorded here:

1. Base network and chain ID.
2. Primary contract and the purpose of every related address.
3. Bounded demo block range and known qualifying transactions.
4. Exact event signatures supported for that target.
5. ERC-20 asset, watched addresses, standard threshold, critical threshold, and base units.
6. Concrete policy addresses and one verified example for each severity.

These values were not part of the approved architecture proposal and must not be invented.
