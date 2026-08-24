# Project Status

Last updated: 2026-08-25

- Current milestone: Multi-profile investigation archive frontend implemented.
- Completed: Added a read-only selector for the three closed profiles, current investigation summary, committed-fixture archive, six-stage method, exact assertion ledger, source links, strict fixture receipt downloads, explicit live-versus-fixture labels, visible empty and failed states, and responsive table and evidence layouts. The browser cannot submit a profile, address, call, event, plan, block, or RPC URL. The API and scanner behavior remain unchanged.
- Tests run: `npm test` passed 15 files and 118 tests. `npm run typecheck` passed with no TypeScript errors. `npm audit --audit-level=moderate` found 0 vulnerabilities. All three archive receipts passed the runtime receipt schema and canonical hash validation. Local HTTP checks passed for `/api/health`, `/api/config`, `/`, and `/archive-data.js`. JavaScript parsing passed for `app.js`, `archive-data.js`, and `view-model.js`.
- Result: The frontend can replay exactly three real committed fixture investigations and can run a live scan only for the server-active ether.fi profile. Automated tests cover selector contents, archive entries, source labels, receipt links, empty state, failed investigations, stale detail behavior, and the mobile layout boundary.
- Current commit: This status update is included in `feat: add multi-profile investigation archive`.
- Public revision: Local HEAD before this task was `c98f0610794efab7b7e782319a3f3adc7ebb329e`. Tracked `origin/main` remains `1daef0f2508e95504111106d2483cc54735878d0`. The ether.fi and frontend commits remain local and unpushed.
- Next step: Run rendered desktop and mobile inspection when an in-app or connected browser session is available, then push only with explicit authorization and verify a clean public clone before claiming public parity.
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
