# Project Status

Last updated: 2026-08-22

- Current milestone: Milestone 3, investigation output and minimal interface.
- Completed: Added evidence-bounded investigation output with separate facts, deterministic interpretation, and limitations. Added the approved Express API, process-local scan storage, sanitized public configuration, static vanilla dashboard, alert list and detail views, evidence links, and visible failure and incomplete-evidence states. The API rejects arbitrary addresses, event selectors, and other scope-expanding fields. No new detector, authentication, notification, monitoring, wallet, transaction, database, deployment, or LLM feature was added.
- Tests run: `npm test`, `npm run typecheck`, `node --check public/app.js`, `npm run dev`, localhost HTTP checks for the dashboard assets and all API routes, a live `POST /api/scans`, dependency audit, secret and unsupported-scope scans, and `git diff --check`.
- Result: Automated and live HTTP checks passed. Vitest reported 6 test files passed and 21 tests passed in 581 ms. TypeScript and browser JavaScript syntax checks completed with no errors. The server listened on `http://localhost:3000`. The live API scan returned status `complete`, one informational alert, one complete evidence record, and zero failures. Health, sanitized config, stored scan, alert list, alert detail, HTML, CSS, and JavaScript responses succeeded. Rendered browser verification did not run because the browser workflow reported no available browser backend.
- Current commit: The milestone commit contains this status update. Use `git log -1 --oneline` for its immutable hash.
- Next step: Connect a browser, verify the dashboard visually at desktop and narrow widths, exercise the scan button, then proceed to milestone 4 hardening.
- Blockers: Rendered browser verification is pending. Server and HTTP-level verification passed.
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
