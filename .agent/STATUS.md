# Project Status

Last updated: 2026-08-23

- Current milestone: Milestone 3 interface refinement, SOC analyst console.
- Completed: Reworked only the existing vanilla frontend into a dense operational console. The interface now has a compact command and health bar, explicit read-only and process-memory states, an active detection profile, session alert queue, deterministic signal strip, decoded proxy-to-implementation event path, separate investigation sections, and a source-linked evidence ledger. The API, target, event, pipeline, and storage scope are unchanged.
- Tests run: `npm test`, `npm run typecheck`, `node --check public/app.js`, `git diff --check`, `npm run dev`, localhost health and configuration checks, and a live `POST /api/scans`.
- Result: Vitest reported 6 test files passed and 21 tests passed. TypeScript, browser JavaScript syntax, and diff checks completed with no errors. The server returned healthy status and sanitized approved configuration. The live bounded scan returned `failed`, zero alerts, and one visible `latest-block-rpc-failed` failure because the configured RPC could not return the latest Base block. The in-app browser runtime exposed no connected browser, so the revised layout still needs rendered desktop and narrow-width QA.
- Current commit: The SOC console refinement commit recorded in Git history. Previous commit: `f0ae5d8 fix: prevent mobile evidence overflow`.
- Next step: Connect a browser, visually verify the revised console in its empty, populated fixture-equivalent, and failure states at desktop and 390px widths, then proceed to milestone 4 hardening.
- Blockers: Rendered verification is blocked by the unavailable browser connection. The live demo is also blocked by the current RPC response failure.
- Decisions needed: None for the implemented milestone 3 scope.

## Setup and run instructions

Use Node.js 24 or newer. Run `npm install`, copy `.env.example` to `.env`, then
run `npm test`, `npm run typecheck`, and `npm run dev`. Open
`http://localhost:3000` and invoke the bounded scan from the dashboard or API.

## Existing validation

The 2026-08-23 refinement retained all 21 passing tests for the deterministic
pipeline, investigation separation, sanitized public configuration, API scope
rejection, in-memory retrieval, structured failures, and dashboard delivery.
The fixture remains a selected-log subset rather than a complete raw receipt.
Current rendered QA and a successful live RPC reproduction remain pending.
