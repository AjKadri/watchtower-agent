# Project Status

Last updated: 2026-08-23

- Current milestone: P0 independent review fixes after Milestone 4.
- Completed: Added live RPC chain verification for exact Base mainnet chain ID `8453`. A scan can report `complete` only when the configured known transaction produces a strictly decoded qualifying `Upgraded(address)` event with complete block, transaction, receipt, and receipt-log evidence. Empty logs, omitted known-transaction logs, and incomplete known evidence now return structured non-complete results. Replacing a deterministic scan ID now removes all previous alert and evidence indexes before saving the latest attempt. The configured Git remote was inspected without changing it, and the absent public branch history is recorded in `.agent/BLOCKERS.md`. No incident class, target, frontend, service, or infrastructure was added.
- Tests run: `npm test`, `npm run typecheck`, the exact targeted wrong-chain and empty-log Vitest command, and `env BASE_RPC_URL=https://base-mainnet.public.blastapi.io npm run scan`. The first sandboxed `npm test` attempt could not bind `127.0.0.1` and reported 5 files and 22 tests passed plus 4 API timeouts. The permitted rerun completed normally.
- Result: The final full Vitest run reported 6 test files and 26 tests passed in 652 ms. The targeted run reported 1 file passed, 2 tests passed, and 7 skipped. TypeScript reported no errors. The live bounded scan exited 0 in 7.85 seconds with status `complete`, one informational alert, one complete evidence record for transaction `0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a`, and zero failures. The live chain-ID request passed before the scan. `git diff --check` passed.
- Current commit: Pending `fix: enforce verified demo scan integrity`. Previous commit: `5c40d62 chore: harden reproducible Watchtower demo`.
- Next step: Keep the approved MVP scope frozen. The repository owner must publish the intended branch to the configured public origin. Complete rendered frontend inspection separately when a browser connection is available.
- Blockers: The configured public origin is reachable but has no branch or local milestone history. Rendered browser inspection remains blocked by the unavailable browser connection.
- Decisions needed: None for the approved P0 fixes.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

The 2026-08-23 P0 verification used the public read-only endpoint
`https://base-mainnet.public.blastapi.io`. The live scan verified chain ID
`8453` and reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`
from Base block `41105890`. The fixture remains a selected-log subset rather
than a complete raw receipt. Detailed evidence and limitation records are in
README. Rendered browser inspection remains pending.
