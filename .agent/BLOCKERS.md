# Blockers

## 2026-08-22: Target-specific implementation inputs are resolved

Status: Resolved

Affected task: Watchtower MVP milestone 1, target and contract definition.

The Base network, target addresses, verified demo range, qualifying transaction,
exact supported event signatures, and deterministic severity policy are recorded
in `.agent/DECISIONS.md`.

Large-movement and pause or unpause detection were removed from this target
profile because the selected history does not provide representative events.
This resolves the gate without fabricating fixtures or thresholds.

Decision needed: None for milestone 1.

## Active blockers

None.

## Resolved blockers

### 2026-08-23: Public origin and clean checkout verified

Status: Resolved

The public GitHub origin is available at verified public HEAD
`7587cce1b439038b0354217bfd265a96f1b367e8`. An unauthenticated clone passed,
and `npm ci` passed from that clean checkout. The technical re-review passed.

Decision needed: None.

### 2026-08-23: Restored original frontend rendered inspection passed

Status: Resolved

The rendered browser inspection passed for the restored frontend. Automated
asset, API, JavaScript, TypeScript, and scan-flow checks remain covered by the
current test and validation commands.

Decision needed: None.

### 2026-08-23: Local RPC note is not a repository blocker

Status: Resolved

The committed `.env.example` contains the documented public endpoint. Plain
`npm run scan` returned the safe `chain-id-rpc-dns` result from the ignored
machine-local setting. An explicit documented-endpoint retry completed with one
verified alert and zero failures. The ignored local value was not read or
changed, and it is not a repository setup or scanner-scope blocker.

Decision needed: None.

## 2026-08-23: Configured Base RPC scan recovered

Status: Resolved

The local server returned healthy and sanitized configuration responses. A new
`POST /api/scans` completed against Base block `41105890` with one
informational alert, complete evidence, and zero failures. Alert list and detail
retrieval also passed.

Decision needed: None.
