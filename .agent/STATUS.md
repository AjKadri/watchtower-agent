# Project Status

Last updated: 2026-08-24

- Current milestone: Final replay-receipt release blockers complete locally.
- Completed: Receipt IDs are recomputed from a stable canonical payload that excludes `receiptId`. Strict runtime refinements reject forged IDs, inconsistent check status, result, assertion, or failure combinations, contradictory required-check dispositions, and receipt fields that disagree with their containing evidence or investigation. Atomic replacement removes a prior receipt after both failed and partial rescans.
- Tests run: `npm test` passed 11 files and 78 tests. `npm run typecheck` passed with no TypeScript errors. Two `npm run scan` attempts returned a safe failed result at chain verification with code `chain-id-rpc-dns`, zero alerts, and zero evidence. `npm audit --audit-level=moderate` could not reach the npm advisory endpoint because registry DNS resolution failed. Tracked-file secret checks and `git diff --check` passed.
- Result: Receipt creation and validation use the same explicit canonicalization. Repeated fixture scans and reordered payload keys produce the same receipt ID. Every requested tampering and stale-receipt regression is covered.
- Local revision: Runtime commit `be696bb` and regression commit `473cfe7`, followed by the documentation commit containing this status update.
- Public revision: Tracked `origin/main` remains `7587cce1b439038b0354217bfd265a96f1b367e8`. The local branch is ahead and has not been pushed. Public reproducibility of the newer investigation, receipt UI, and integrity changes is not claimed.
- Next step: Obtain explicit authorization before pushing the local commits. Do not add signing, EAS anchoring, authentication, notifications, monitoring, extra targets or events, wallet access, transactions, LLM integration, or Agent Router calls without approval.
- Blockers: No local implementation blocker. Current live scan and audit verification are limited by external DNS resolution. Public release verification is also blocked until the unpublished commits are pushed by an authorized action.
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
to tracked files or validation output.
