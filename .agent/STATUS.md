# Project Status

Last updated: 2026-08-24

- Current milestone: ether.fi Base weETH OFT investigation profile implemented and selected.
- Completed: Independently reproduced the qualifying block, transaction, successful receipt, upgrade log, implementation transition, 17,594-byte implementation code, LayerZero endpoint, token identity, and shared decimals through the configured Alchemy Base archive RPC. Added the committed ether.fi fixture, exact six-check investigation tests, pruned-history classification, and bounded documentation. Aave and Compound remain fixture-backed and covered.
- Tests run: `npm test` passed 15 files and 111 tests. `npm run typecheck` passed with no TypeScript errors. `npm audit --audit-level=moderate` found 0 vulnerabilities. `git diff --check` passed. Tracked secret checks found no `.env`, Alchemy credential, or credentialed provider URL.
- Live result: Two plain `npm run scan` attempts selected ether.fi block `23487559` but returned the safe `chain-id-rpc-dns` failure because the machine resolver returned `ENOTFOUND`. The same CLI routed through a temporary DNS-only preload to the DNS-over-HTTPS address for the unchanged configured Alchemy hostname completed with one informational `contract_upgrade` alert, one complete evidence record, zero failures, a corroborated disposition, alert `alert_ab98e3ce908cbf4261b579a876f24f230e33dab850fa117a563d301be636e74a`, and receipt `receipt_af9ac18199f550c4d6ccf64a16334dd03afbbe3a3bf06c705347e16684bd64b5`.
- Result: ether.fi is now a supported, fixture-backed profile. Complete, contradicted, pruned-history, timeout, and rate-limit outcomes are tested. Runtime reads remain fixed to blocks `23487558` and `23487559`. No current-state fallback, arbitrary call, dynamic proxy discovery, alternate provider, new incident class, or client-controlled scope was added.
- Current commit: This status update is included in `feat: add etherfi Base investigation profile`.
- Public revision: Public and local `main` were aligned at `1daef0f2508e95504111106d2483cc54735878d0` before this task. This task's commit remains local and unpushed.
- Next step: Push only with explicit authorization, then verify a clean public clone before claiming public reproducibility of the ether.fi profile.
- Blockers: The machine's default resolver currently returns `ENOTFOUND` for the configured Alchemy hostname. DNS-over-HTTPS resolves it and the unchanged endpoint completes the scan. Plain local scanning remains DNS-blocked until the machine resolver recovers.
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
