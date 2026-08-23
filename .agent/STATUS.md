# Project Status

Last updated: 2026-08-24

- Current milestone: Bounded historical upgrade investigation checks complete.
- Completed: Extended the existing read-only `ChainReader` and deterministic evidence pipeline with exactly six fixed historical checks for the approved Aave upgrade. Required checks cover the EIP-1967 implementation slot at blocks `41105889` and `41105890`, decoded implementation bytecode at `41105890`, and Aave `getPool()` at `41105890`. Optional `POOL_REVISION()` reads run only at the two approved blocks and remain non-authoritative for severity, event classification, and final disposition. Every check records its RPC method, fixed public parameters, exact block tag, normalized result, assertion, status, and safe per-check failure.
- Tests run: `npm test` passed 10 files and 46 tests. `npm run typecheck` passed with no TypeScript errors. `npm run scan` completed against the Alchemy Base Mainnet archive RPC configured in the ignored `.env` file.
- Result: The live scan returned one informational `contract_upgrade` alert and one complete evidence record with no failures. The bounded investigation disposition was `corroborated`, all six checks passed, the implementation changed from `0x79ab8fc5ba13daf37b4e978a543286bc2a16508c` to `0xdb578d67a83e94de73c9e0c14280f804f6c1c3e4`, bytecode was present at `22,757` bytes, `getPool()` returned the configured proxy, and the optional revisions were `9` and `10`. The RPC URL, key, provider bodies, and stack traces were not recorded.
- Current revision: The milestone commit containing this status update, with parent `3ec4d27` (`docs: approve bounded upgrade investigation`).
- Next step: Do not add the planner, receipt API, dashboard investigation trace, LLM integration, Agent Router calls, or any scope expansion until explicitly approved.
- Blockers: None.
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
