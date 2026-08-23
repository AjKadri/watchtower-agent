# Project Status

Last updated: 2026-08-24

- Current milestone: Investigation implementation gate after the archive-RPC capability spike.
- Completed: Approved a read-only investigation for the configured Aave Pool proxy, the approved `Upgraded(address)` trigger, and only blocks `41105889` and `41105890`. Required evidence is the EIP-1967 implementation transition, new implementation bytecode, and Aave `getPool()` result. `POOL_REVISION()` is optional corroboration and cannot control severity, classification, or disposition. Recorded the `corroborated`, `contradicted`, and `incomplete` dispositions and kept all wallet, transaction, monitoring, notification, authentication, extra-target, and unrestricted-tool scope excluded. No application code changed.
- Tests run: A sanitized read-only capability probe used the Alchemy Base Mainnet archive RPC from `BASE_RPC_URL` to call `eth_chainId`, historical `eth_getStorageAt`, historical `eth_getCode`, and historical `eth_call` for `getPool()` and `POOL_REVISION()`.
- Result: Every archive check succeeded on its first attempt. Chain ID was `8453`; the implementation changed from `0x79ab8fc5ba13daf37b4e978a543286bc2a16508c` to `0xdb578d67a83e94de73c9e0c14280f804f6c1c3e4`; the new implementation had `22,757` bytes of code; `getPool()` returned the configured proxy; and `POOL_REVISION()` changed from `9` to `10`. No RPC URL, key, provider body, or stack trace was recorded.
- Current commit: `d3aa0fae90a7d27f2d7c65b4322ea70ed8660b14` (`docs: refresh public repository handoff status`), the HEAD before this decision-only commit.
- Next step: Implement only the approved bounded investigation contract when explicitly tasked. Keep the existing scanner, API, dashboard, and product scope unchanged until then.
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
