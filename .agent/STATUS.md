# Project Status

Last updated: 2026-08-25

- Current milestone: Release hardening batch REV-1 complete, REV-3 and REV-5 pending.
- Completed: Scan HTTP semantics now return 201 for complete, 200 for partial, 502 for malformed or wrong-chain upstream failures, 503 for other upstream failures, and the existing 400, 415, or 413 request errors. The frontend preserves and renders structured failed scan bodies from non-2xx responses.
- Tests run: Focused API and frontend validation passed 2 files and 25 tests. `npm run typecheck`, `node --check public/app.js`, and `git diff --check` passed.
- Result: Complete, partial, 502, 503, and invalid-request response paths preserve their documented semantics. The browser recognizes a structured scan response in a non-2xx body and displays its safe failures.
- Current commit: This status update is included in `fix: align scan HTTP status semantics`.
- Public revision: Local HEAD and tracked `origin/main` were aligned at `db7d9995d1b625bff9744402f5414ada80ce9512` before this release-hardening batch. New hardening commits remain local until explicitly pushed.
- Next step: Implement REV-3 malformed RPC evidence containment, then REV-5 compiled production startup.
- Blockers: No browser session was available for rendered inspection. The machine's default resolver may still return `ENOTFOUND` for plain Alchemy scans, while the previously verified DNS-only path reaches the unchanged provider.
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
