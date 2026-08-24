# Project Status

Last updated: 2026-08-24

- Current milestone: Closed target-profile registry refactor implemented for the three approved Base targets.
- Completed: Added validated Aave V3 Base Pool, Compound III Base USDC Comet, and ether.fi Base weETH OFT profiles. Scanner, planner, investigation executor, receipt validation, API public configuration, and existing dashboard data now consume the selected profile. Unknown profiles, selector overrides, foreign check IDs, arbitrary addresses, and arbitrary calls are rejected. Aave remains the selected fixture and its receipt payload stays deterministic.
- Tests run: `npm test` passed 13 files and 92 tests. `npm run typecheck` passed with no TypeScript errors. Focused registry, planner, investigation, scanner, schema, fixture, and severity tests passed 7 files and 70 tests. API and server startup tests passed 2 files and 8 tests outside the restricted sandbox because they bind a loopback port. `git diff --check` passed.
- Result: The requested registry refactor is complete. All three profiles are closed and typed, the API cannot select or override profile capabilities, and existing Aave behavior remains covered. No Compound or ether.fi fixtures or dashboard controls were added.
- Current commit: This status update is included in `refactor: add closed target profile registry`.
- Public revision: `origin/main` was `7e261a9` at task start. The requested refactor commit remains local and unpushed.
- Next step: In a separately approved task, add verified fixtures and dashboard selection for Compound and ether.fi. Repeat the unchanged Aave live scan when the configured Alchemy hostname resolves.
- Blockers: The configured Alchemy Base hostname previously returned `ENOTFOUND`, which still blocks a current live scan. Live scanning was not required for this refactor.
- Decisions needed: None. The bounded investigation gate remains approved.

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

The 2026-08-24 receipt-integrity verification used the same ignored local
configuration. No RPC URL, credential, provider body, or stack trace was added
to tracked files or validation output. The address-casing fix passes all local
fixture and schema checks, while the current live retry remains blocked by
Alchemy hostname resolution.
