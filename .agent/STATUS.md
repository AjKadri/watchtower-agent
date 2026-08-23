# Project Status

Last updated: 2026-08-23

- Current milestone: Remaining review cleanup after the P1 fixes.
- Completed: Replaced the stale fixture incident class with `contract_upgrade` and added direct fixture coverage. Confirmed and documented the API contract as HTTP 415 for missing or unsupported content types, HTTP 400 for malformed JSON or invalid JSON fields, and HTTP 413 for oversized bodies. Added separate missing-content-type and unsupported-content-type assertions. Reconciled the handoff with the passed rendered browser inspection and removed the machine-local RPC note from active repository blockers. No scanner behavior, scope, or frontend design changed.
- Tests run: `npm test`, `npm run typecheck`, `npm run scan`, `env BASE_RPC_URL=https://base-mainnet.public.blastapi.io npm run scan`, and `npm audit --audit-level=moderate`.
- Result: Vitest reported 9 test files and 41 tests passed in 1.48 seconds. TypeScript reported no errors and npm audit found zero vulnerabilities. Plain `npm run scan` exited 1 with the safe `chain-id-rpc-dns` category from the ignored machine-local setting. After one transient DNS failure, the documented public-endpoint retry exited 0 in 5.93 seconds with chain ID `8453`, one complete `contract_upgrade` informational alert, one complete evidence record, and zero failures. The local setting was not read or changed and is not a repository blocker. Rendered browser inspection passed.
- Current commit: `0f4247ce465d129b4b7231f5f0239dff95d6598c` (`fix: close review findings and align demo behavior`), the HEAD reviewed before this cleanup commit.
- Next step: Keep the approved MVP scope frozen and publish the intended branch to the configured public origin.
- Blockers: The configured public GitHub origin is reachable but still contains no branch or local milestone history.
- Decisions needed: None for this cleanup.

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
