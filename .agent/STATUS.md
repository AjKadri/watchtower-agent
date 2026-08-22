# Project Status

Last updated: 2026-08-22

- Current milestone: Milestone 3, investigation output and minimal interface.
- Completed: Added evidence-bounded investigation output with separate facts, deterministic interpretation, and limitations. Added the approved Express API, process-local scan storage, sanitized public configuration, static vanilla dashboard, alert list and detail views, evidence links, and visible failure and incomplete-evidence states. The API rejects arbitrary addresses, event selectors, and other scope-expanding fields. Added a responsive CSS fix so long evidence values wrap at narrow widths. No new detector, authentication, notification, monitoring, wallet, transaction, database, deployment, or LLM feature was added.
- Tests run: `npm test`, `npm run typecheck`, `node --check public/app.js`, `npm run dev`, localhost HTTP checks for the dashboard assets and all API routes, a live `POST /api/scans`, dependency audit, secret and unsupported-scope scans, `git diff --check`, desktop browser QA, and 390px mobile browser QA.
- Result: All automated, live HTTP, and rendered browser checks passed. Vitest reported 6 test files passed and 21 tests passed. TypeScript and browser JavaScript syntax checks completed with no errors. The live API and browser scans returned status `complete`, one informational alert, one complete evidence record, and zero failures. The dashboard scan button, alert list, evidence detail view, desktop layout, and narrow layout were verified. Mobile horizontal overflow was fixed and rechecked at 390px with zero overflow.
- Current commit: `f0ae5d8 fix: prevent mobile evidence overflow`, following milestone commit `0e57335 feat: add Watchtower API and dashboard`.
- Next step: Proceed to milestone 4 hardening: clean-checkout verification, documented demo run, latency/RPC limitation capture, and final scope review.
- Blockers: None for milestone 3.
- Decisions needed: None for the implemented milestone 3 scope.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

Milestone 3 automated and live HTTP validation passed on 2026-08-22. Tests cover
the existing deterministic pipeline, investigation separation, sanitized public
configuration, API scope rejection, in-memory retrieval, structured failures,
and dashboard asset delivery. The live API scan reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`.
The fixture remains a selected-log subset rather than a complete raw receipt.
Visual browser QA is still required because no browser backend was connected.
