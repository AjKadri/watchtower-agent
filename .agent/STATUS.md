# Project Status

Last updated: 2026-08-22

- Current milestone: Milestone 1, target configuration and verified fixtures.
- Completed: Selected Base mainnet and a one-block Aave V3 Base core target. Added a validated target profile, exact ABI fragments for `Upgraded(address)` and `PoolUpdated(address,address)`, normalized alert and evidence schemas, curated BaseScan-backed fixture data, provenance notes, and validation tests. Explicitly excluded large-transfer, pause, and unpause detection because the selected transaction does not verify those classes. No scanner, API, dashboard, or application server was added.
- Tests run: `npm test`, `npm run typecheck`, and `git diff --check`.
- Result: Passed. Vitest reported 3 test files passed and 9 tests passed in 388 ms. TypeScript completed with no errors. Git reported no whitespace errors.
- Current commit: The milestone commit contains this status update. Use `git log -1 --oneline` for its immutable hash.
- Next step: Milestone 2, implement the deterministic evidence pipeline against only the approved target range and event signatures. Do not add the API or dashboard yet.
- Blockers: None.
- Decisions needed: None for milestone 1.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, `npm test`, and
`npm run typecheck`. There is no application to run yet. The approved future
local command is `npm run dev`.

## Existing validation

Milestone 1 validation passed on 2026-08-22. Tests cover target bounds and scope,
severity examples, fixture identity, detector-to-log matching, indexed-address
decoding, and normalized record validation. The fixture is a selected-log subset,
not a complete transaction receipt.
