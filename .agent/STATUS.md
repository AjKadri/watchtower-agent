# Project Status

Last updated: 2026-08-24

- Current milestone: Deterministic investigation planning and replayable receipt implementation complete. Live RPC revalidation is pending provider DNS recovery.
- Completed: Added three strict version `1.0.0` plans: `corroborate-approved-upgrade`, `escalate-unapproved-upgrade`, and `stop-incomplete`. Planning uses only fixed target, event, trigger-evidence, and severity-rule state. Each plan records a fixed selection reason, selected and skipped checks, allowed read capabilities, and maximum uses. The bounded executor validates the plan before reading and enforces budgets of six, four, or zero reads. Added a strict JSON-safe receipt with a deterministic ID, complete trigger evidence, plan details, normalized RPC checks, assertions, safe failures, limitations, final disposition, and explorer links. No route or dashboard change was made.
- Tests run: `npm test` passed 11 files and 60 tests. `npm run typecheck` passed with no TypeScript errors. `npm run scan` was run three times against the unchanged Alchemy Base archive RPC configured in the ignored `.env` file.
- Result: Fixture-backed tests passed for corroborated, contradicted, incomplete, deterministic receipt ID, identical replay, rejected arbitrary planner scope and receipt addresses, and skipped optional revision checks. Each live scan attempt stopped safely at chain verification with exit code `1`, status `failed`, and `chain-id-rpc-dns`. No alert or receipt was produced during those attempts. The RPC URL, key, provider bodies, and stack traces were not exposed.
- Current revision: The milestone commit containing this status update, with parent `3be29e0` (`feat: add bounded upgrade investigation checks`).
- Next step: Retry the unchanged documented live scan when the configured provider hostname resolves. Do not substitute another provider or add receipt API, dashboard trace, signing, EAS anchoring, cryptographic verification, LLM integration, or scope expansion without approval.
- Blockers: No repository implementation blocker. The current execution environment could not resolve the configured RPC hostname during final live validation.
- Decisions needed: None. The bounded investigation gate is approved.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm ci`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

The 2026-08-23 P1 verification used the public read-only endpoint
`https://base-mainnet.public.blastapi.io`. The live scan verified chain ID
`8453` and reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`
from Base block `41105890`. The fixture remains a selected-log subset rather
than a complete raw receipt. Detailed evidence and limitation records are in
README. Rendered browser inspection passed.

The 2026-08-24 archive capability spike used the Alchemy Base Mainnet archive
RPC configured through the ignored `BASE_RPC_URL`. Historical storage, code,
`getPool()`, and optional `POOL_REVISION()` calls all passed for the approved
fixture without exposing provider configuration.
