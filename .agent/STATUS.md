# Project Status

Last updated: 2026-08-24

- Current milestone: Visible investigation trace and replay receipt UI complete.
- Completed: The existing scan and alert-detail responses expose the deterministic investigation and validated receipt. Added strict deterministic-ID validation to scan, alert, and receipt lookups, plus `GET /api/receipts/:receiptId` for validated JSON attachment download. The in-memory store removes stale receipt indexes during atomic scan replacement. The dashboard now renders the existing six-stage investigation in the original visual language, including selected plan and budget, passed, failed, unsupported, and skipped checks, source links, conditional elapsed time, final disposition, receipt ID, and receipt download. Stale detail responses are rejected and cleared when selection changes.
- Tests run: `npm test` passed 11 files and 64 tests. `npm run typecheck` passed with no TypeScript errors. `npm run scan` completed against the configured Alchemy Base archive RPC. `npm audit --audit-level=moderate` reported zero vulnerabilities. `node --check public/app.js` and `node --check public/view-model.js` passed.
- Result: The CLI and local API scans each returned one informational `contract_upgrade` alert, one complete evidence record, a `corroborated` six-check investigation, receipt `receipt_b5047efed41b7c2536717f0338fea22a142057ce99b30928d4d700d2fd160fee`, and zero failures. Local `/api/health` passed. The receipt download returned parseable JSON with six checks, the corroborated disposition, JSON content type, attachment disposition, and no-store caching. The RPC URL, key, provider bodies, and stack traces were not exposed.
- Current revision: The milestone commit containing this status update, with parent `1688b46` (`feat: add deterministic investigation plans and receipts`).
- Next step: Do not add signing, EAS anchoring, authentication, notifications, monitoring, extra targets or events, wallet access, transactions, LLM integration, or Agent Router calls without approval.
- Blockers: No repository implementation blocker. Rendered browser inspection was unavailable because this environment had no connected in-app or external browser. HTTP, asset syntax, view-model, API, and integration checks passed.
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
