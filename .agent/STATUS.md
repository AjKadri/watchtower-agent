# Project Status

Last updated: 2026-08-23

- Current milestone: Milestone 3 visual redesign, light research and verification workspace.
- Completed: Replaced the rejected dark SOC presentation with an off-white editorial workspace using strong serif-led hierarchy, a calm teal accent, readable finding summaries, structured scope metadata, research-style investigation and evidence cards, trustworthy source actions, subtle borders and shadows, responsive breakpoints, accessible focus states, and polished loading, empty, partial, error, and incomplete-evidence treatments. Only the vanilla frontend changed. The backend, API routes, data models, scanner, target, detector, and storage behavior are unchanged.
- Tests run: `npm test`, `npm run typecheck`, `node --check public/app.js`, `git diff --check`, `npm run dev`, localhost health and configuration checks, and a live `POST /api/scans`.
- Result: The final Vitest run reported 6 test files passed and 21 tests passed. TypeScript, browser JavaScript syntax, and diff checks completed with no errors. The local dashboard, stylesheet, and browser script returned HTTP 200. The live bounded scan returned `complete`, one informational alert, one complete evidence record, and zero failures for Base block `41105890`. `GET /api/alerts/:alertId` returned the full investigation and evidence record. The browser runtime exposed no connected browser, so rendered desktop and narrow-width QA remains pending.
- Current commit: Pending `style: redesign Watchtower research workspace`. Previous commit: `798dcce style: redesign Watchtower security console`.
- Next step: Connect a browser and visually verify the light workspace in its empty, populated, loading, partial, failure, and incomplete-evidence states at desktop and 390px widths, then proceed to milestone 4 hardening.
- Blockers: Rendered verification is blocked by the unavailable browser connection. The live RPC and bounded scan flow are working.
- Decisions needed: None for the implemented milestone 3 scope.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

The 2026-08-23 research-workspace redesign retained all 21 passing tests for the deterministic
pipeline, investigation separation, sanitized public configuration, API scope
rejection, in-memory retrieval, structured failures, and dashboard delivery.
The live scan reproduced alert
`alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`.
The fixture remains a selected-log subset rather than a complete raw receipt.
Rendered QA remains pending.
