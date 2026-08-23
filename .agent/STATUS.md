# Project Status

Last updated: 2026-08-23

- Current milestone: Reviewed P1 correctness and usability fixes after Milestone 4.
- Completed: Made server startup await the listen event and convert listen failures into a safe message and nonzero exit. Enforced JSON scan requests, strict body shapes, and a 16 KB limit with HTTP 400, 413, and 415 responses. Added safe DNS, timeout, rate-limit, malformed-response, wrong-chain, unavailable, and incomplete-evidence categories. Malformed RPC logs are isolated so valid siblings continue through the evidence pipeline. The committed ABI is loaded and checked against the configured topic and strict decoder. The `Contract upgrade` label is shared by configuration, alerts, and the dashboard. The frontend now calls `/api/health`, labels timestamps as UTC, exposes the reviewed evidence fields and address roles, and clears stale selections. README now uses `npm ci` and matches these behaviors. No target, detector, incident class, monitoring, authentication, wallet, transaction, notification, project, or LLM scope was added.
- Tests run: `npm test`, `npm run typecheck`, `npm run scan` twice with the ignored local environment, `env BASE_RPC_URL=https://base-mainnet.public.blastapi.io npm run scan`, `npm audit --audit-level=moderate`, and `node --check public/app.js && node --check public/view-model.js`.
- Result: Final Vitest reported 9 test files and 40 tests passed in 621 ms. TypeScript and both browser JavaScript syntax checks passed. Plain `npm run scan` exited 1 twice with the safe `chain-id-rpc-dns` category, no alerts, and no evidence because the ignored local RPC host did not resolve. The documented public endpoint override exited 0 in 7.12 seconds with chain ID `8453`, status `complete`, one `Contract upgrade` informational alert, one complete evidence record, and zero failures. npm audit found zero vulnerabilities.
- Current commit: Pending `fix: close review findings and align demo behavior`. Previous commit: `82396c3 fix: enforce verified demo scan integrity`.
- Next step: Keep the approved MVP scope frozen. Refresh the ignored local `.env` from `.env.example` for plain `npm run scan`, publish the intended branch to the configured public origin, and complete rendered frontend inspection when a browser connection is available.
- Blockers: The ignored local RPC host currently fails DNS resolution. The documented public endpoint works through an environment override. The configured public origin still has no branch history, and rendered browser inspection remains blocked by the unavailable browser connection.
- Decisions needed: None for the approved P1 fixes.

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
README. Rendered browser inspection remains pending.
