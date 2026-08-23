# Project Status

Last updated: 2026-08-23

- Current milestone: Milestone 4 demo hardening.
- Completed: Verified the README workflow from a fresh clone, the fixed Aave Base scan, reproduced upgrade alert, full evidence record, four displayed BaseScan links, partial and failed behavior, secret boundaries, ignored environment files, dependency audit, and local server/API flow. Recorded exact commands, expected output, latency, the working public endpoint, RPC limits, unsupported events, failure behavior, and evidence verification in README. Added `.agent/private/` to `.gitignore`. No product feature, backend behavior, scanner behavior, approved scope, or frontend file changed.
- Tests run: clean-clone `npm install`, `npm test`, `npm run typecheck`, timed `npm run scan`, `npm audit --audit-level=moderate`, `npm run dev`, dashboard and API HTTP checks, targeted verbose scanner/API tests, forced unreachable-RPC scan, 26 live JSON-RPC evidence checks, four BaseScan link checks, ignore checks, tracked-file secret scans, `node --check public/app.js`, and `git diff --check`.
- Result: Node `v24.15.0` and npm `11.12.1` installed 144 packages. Vitest reported 6 test files and 21 tests passed. The targeted partial and failed suite reported 2 files and 8 tests passed. TypeScript reported no errors and npm audit found zero vulnerabilities. The clean-clone CLI scan completed in 3.96 seconds and the final workspace rerun completed in 3.03 seconds. The local API scan completed in 2.268 seconds with status `complete`, one informational alert, one complete evidence record, and zero failures. All 26 evidence checks passed against Base and all four BaseScan links returned HTTP 200. A forced unreachable RPC returned a sanitized failed result and exit code 1. `.env`, `.env.*`, and `.agent/private/` are ignored, `.env.example` is tracked, and no credential pattern was found in tracked source. The browser runtime exposed no connected browser, so rendered inspection remains pending.
- Current commit: Pending `chore: harden reproducible Watchtower demo`. Previous commit: `062c8a9 revert: restore original Watchtower frontend`.
- Next step: Keep the approved MVP scope frozen. Complete rendered desktop and 390px inspection when a browser connection is available, then prepare the existing reproducible demo for review without adding features.
- Blockers: Rendered browser inspection is blocked by the unavailable browser connection. The clean setup, live RPC, CLI, API, evidence, explorer links, tests, and audit are working.
- Decisions needed: None for milestone 4.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

The 2026-08-23 clean-clone audit used the public read-only endpoint
`https://base-mainnet.public.blastapi.io`. The live scan reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`
from Base block `41105890`. The fixture remains a selected-log subset rather
than a complete raw receipt. Detailed evidence and limitation records are in
README. Rendered browser inspection remains pending.
