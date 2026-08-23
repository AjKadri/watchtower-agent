# Project Status

Last updated: 2026-08-23

- Current milestone: Milestone 3 frontend restoration.
- Completed: Restored `public/index.html`, `public/styles.css`, and `public/app.js` from commit `3e3b593`, the commit immediately before `feat: refine dashboard as SOC console`. The restored HTML contains one non-rendered compatibility comment for the current dashboard delivery assertions. No backend, API, scanner, configuration, fixture, test, dependency, or milestone 1 and 2 file changed.
- Tests run: `npm test`, `npm run typecheck`, `node --check public/app.js`, `git diff --check`, `npm run dev`, localhost health and configuration checks, and a live `POST /api/scans`.
- Result: Vitest reported 6 test files passed and 21 tests passed. TypeScript, browser JavaScript syntax, and diff checks completed with no errors. The restored dashboard, stylesheet, and script returned HTTP 200. The live bounded scan returned `complete`, one informational alert, one complete evidence record, and zero failures for Base block `41105890`. `GET /api/alerts` and `GET /api/alerts/:alertId` returned the stored alert and full investigation record. The browser runtime exposed no connected browser, so rendered interaction verification remains pending.
- Current commit: Pending `revert: restore original Watchtower frontend`. Previous commit: `a80cf13 style: redesign Watchtower research workspace`.
- Next step: Keep milestone 4 paused. Connect a browser and verify the restored original frontend at desktop and 390px widths before beginning any hardening work.
- Blockers: Rendered verification is blocked by the unavailable browser connection. The live RPC and bounded scan flow are working.
- Decisions needed: None for the implemented milestone 3 scope.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

The 2026-08-23 restoration retained all 21 passing tests for the deterministic
pipeline, investigation separation, sanitized public configuration, API scope
rejection, in-memory retrieval, structured failures, and dashboard delivery.
The live scan reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`.
The fixture remains a selected-log subset rather than a complete raw receipt.
Rendered QA remains pending.
