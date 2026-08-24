# Project Status

Last updated: 2026-08-24

- Current milestone: Compound III Base USDC Comet investigation profile implemented and selected.
- Completed: Independently reproduced the qualifying transaction, block, upgrade log, implementation transition, 18,599-byte implementation code, governor at N-1 and N, and Base USDC at N through the configured Alchemy archive RPC. Added the committed Compound fixture, exact six-check investigation tests, closed-profile dashboard trace support, and Compound documentation. Aave behavior remains covered and ether.fi remains fixture-pending.
- Tests run: `npm test` passed 14 files and 101 tests. `npm run typecheck` passed with no TypeScript errors. Focused Compound, registry, fixture, scanner, and frontend tests passed. Plain `npm run scan` selected Compound but returned the safe `chain-id-rpc-dns` failure because the machine resolver still returned `ENOTFOUND`. The same command routed through a temporary DNS-over-HTTPS-resolved loopback bridge to the unchanged configured Alchemy endpoint exited 0 with one alert, one complete evidence record, zero failures, a corroborated disposition, and receipt `receipt_9e87dba3784fba97a3c51f81bf5d34e878342113eeeb65e3a83f07a4ae07327f`.
- Result: Compound is a supported, fixture-backed profile. Complete, contradicted, and incomplete outcomes are tested. Runtime reads remain fixed to blocks `40235589` and `40235590`, and no current-state fallback, arbitrary call, dynamic discovery, alternate provider, or client-controlled scope was added.
- Current commit: This status update is included in `feat: add Compound Base investigation profile`.
- Public revision: `origin/main` is `7e261a9`. This task's commit remains local and unpushed.
- Next step: Implement the ether.fi fixture only after independently reproducing every fixed historical value through the configured archive RPC.
- Blockers: The machine's default resolver still returns `ENOTFOUND` for the configured Alchemy hostname. DNS-over-HTTPS resolves it and the verified endpoint completes the scan, but plain local startup remains DNS-blocked until the resolver recovers.
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
