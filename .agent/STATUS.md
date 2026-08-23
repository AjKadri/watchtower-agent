# Project Status

Last updated: 2026-08-23

- Current milestone: Public repository handoff refresh after technical re-review.
- Completed: Published the reviewed repository state at public HEAD `7587cce1b439038b0354217bfd265a96f1b367e8`. The public GitHub origin is available, an unauthenticated clone passed, and `npm ci` passed from the clean checkout. The technical re-review passed. Fixture incident classes are corrected to `contract_upgrade`. The API contract remains HTTP 415 for missing or unsupported content types, HTTP 400 for malformed JSON or invalid fields, and HTTP 413 for oversized bodies. The old pending-commit and public-origin records are resolved. No application code changed in this handoff refresh.
- Tests run: Public verification used an unauthenticated clone and `npm ci` from the clean checkout. The technical re-review covered the corrected fixture label and documented API status contract.
- Result: Public repository access, unauthenticated clone, clean dependency installation, rendered browser inspection, and technical re-review passed. The verified public implementation HEAD is `7587cce1b439038b0354217bfd265a96f1b367e8`.
- Current commit: `7587cce1b439038b0354217bfd265a96f1b367e8` (`docs: align Watchtower handoff and API contracts`), the current verified public HEAD before this documentation-only refresh.
- Next step: Keep the approved MVP scope frozen. No corrective implementation task remains from the review.
- Blockers: None.
- Decisions needed: None.

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
