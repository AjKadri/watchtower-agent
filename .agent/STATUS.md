# Project Status

Last updated: 2026-08-22

- Current milestone: Milestone 2, deterministic Base evidence pipeline.
- Completed: Added a read-only viem Base client, exact one-block scan bounds, RPC address and topic filtering, strict `Upgraded(address)` decoding, cached block, transaction, and receipt evidence retrieval, exact receipt-log verification, normalized alerts and evidence, fixed severity rules, SHA-256 scan and alert IDs, duplicate prevention, structured validation, RPC, decode, and incomplete-evidence failures, fixture-backed tests, and an opt-in CLI. Narrowed the target profile to the Aave Pool proxy upgrade event only. No ownership, pause, transfer, API, dashboard, continuous monitoring, notification, database, or LLM feature was added.
- Tests run: `npm test`, `npm run typecheck`, `BASE_RPC_URL=https://base-mainnet.public.blastapi.io npm run scan`, `npm audit --audit-level=moderate`, secret-pattern scan, and `git diff --check`.
- Result: Passed. Vitest reported 5 test files passed and 18 tests passed in 769 ms. TypeScript completed with no errors. The live scan exited 0 with status `complete`, one informational alert, one complete evidence record, and zero failures for block `41105890`. npm reported 0 vulnerabilities. The secret scan found no assigned credentials, and Git reported no whitespace errors.
- Current commit: The milestone commit contains this status update. Use `git log -1 --oneline` for its immutable hash.
- Next step: Milestone 3 only after a new task confirms the API and dashboard boundary.
- Blockers: None.
- Decisions needed: None for milestone 2.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, set a
read-only `BASE_RPC_URL`, then run `npm test`, `npm run typecheck`, and
`npm run scan`. There is no HTTP application to run yet.

## Existing validation

Milestone 2 validation passed on 2026-08-22. Tests cover fixed target scope,
bounds, strict decoding, severity, normalized records, stable IDs, duplicate
prevention, exact RPC filters, complete fixture evidence, RPC failures, invalid
ranges, and incomplete evidence. The live scan reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`.
The fixture remains a selected-log subset rather than a complete raw receipt.
