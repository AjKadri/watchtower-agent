# Project Status

Last updated: 2026-08-24

- Current milestone: Address-casing receipt regression and CLI classification fixed locally. Live release verification remains DNS-blocked.
- Completed: Added one shared EVM address normalizer and applied it to fixed configuration, viem values, evidence, trigger and check comparisons, severity policy, and canonical receipt hashing. Equivalent lowercase and checksum addresses now compare equally and produce the same receipt ID. CLI errors now separate configuration validation, runtime result validation, receipt or evidence consistency, and RPC failures using safe output.
- Tests run: `npm test` passed 13 files and 87 tests. `npm run typecheck` passed with no TypeScript errors. Three `npm run scan` attempts returned `status: failed` at chain verification with `chain-id-rpc-dns`, zero alerts, and zero evidence. A direct Alchemy Base hostname lookup returned `ENOTFOUND`. `npm audit --audit-level=moderate` passed with zero vulnerabilities. Tracked-file secret checks and `git diff --check` passed.
- Result: All fixture-backed and real-shaped validation paths pass, including lowercase viem emitters against checksum configuration, checksum runtime values against lowercase configuration, implementation casing, complete receipt validation, stable casing-independent receipt IDs, and runtime CLI failure classification. The required current live scan result was not reproduced because Alchemy DNS resolution failed before RPC chain verification.
- Local revision: Address normalization commit `3451a49` and CLI classification commit `7e6336a`, followed by the documentation commit containing this status update.
- Public revision: Verified public HEAD is `0d84203674861f76ab024c8150ae79e5c580b3ea`. Public and local `main` were aligned there at task start. This task's commits remain local and unpushed as required.
- Next step: Repeat `npm run scan` without changing providers when Alchemy DNS resolves. Require a complete scan with one `contract_upgrade` alert, complete evidence, a corroborated investigation, a valid receipt, and zero failures. Obtain explicit authorization before any push.
- Blockers: The configured Alchemy Base hostname currently returns `ENOTFOUND`, blocking the required live scan. This task's commits are not public because pushing is explicitly prohibited.
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
