# Project Status

Last updated: 2026-08-25

- Current milestone: Release hardening batches REV-1, REV-3, and REV-5 complete.
- Completed: Scan HTTP outcomes are explicit, ChainReader evidence responses are runtime-validated with per-candidate containment, and production runs compiled JavaScript from `dist/` without `tsx`.
- Tests run: `npm test` passed 15 files and 128 tests. `npm run typecheck`, `npm run build`, `npm audit --audit-level=moderate`, `git diff --check`, and the tracked secret scan passed. Audit reported 0 vulnerabilities.
- Result: A clean candidate checkout passed `npm ci --omit=dev`, installing 94 packages and auditing 95 with 0 vulnerabilities. `npm run build` succeeded. `npm start` served `GET /api/health` with `status: ok`, network `base-mainnet`, and target `etherfi-base-weeth-oft`. The compiled entrypoint handled SIGTERM and exited with status 0.
- Current commit: This status update is included in `build: add production Watchtower artifact`.
- Public revision: Local HEAD and tracked `origin/main` were aligned at `db7d9995d1b625bff9744402f5414ada80ce9512` before this release-hardening batch. New hardening commits remain local until explicitly pushed.
- Next step: Push only with explicit authorization, verify the resulting public HEAD from an unauthenticated clean clone, and repeat rendered desktop and mobile inspection when a browser session is available.
- Blockers: The three release-hardening commits are local and not yet public. No browser session was available for rendered inspection.
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

The 2026-08-24 Compound verification used only the configured Alchemy Base
archive RPC and exact historical block tags. A temporary loopback bridge worked
around the machine DNS resolver without changing the provider or repository.
The complete scan produced one informational alert, complete evidence, a
corroborated deterministic receipt, and zero failures.
