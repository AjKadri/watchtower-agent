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

### 2026-08-23: Redesigned security console needs rendered verification

Status: Active

The in-app browser runtime reported no available browser connection. Automated
tests, JavaScript syntax, TypeScript, asset delivery, and the live scan flow
passed, but the redesigned layout has not been inspected at desktop or 390px
widths.

Required resolution: Connect an in-app browser and verify empty, populated, and
failure states without horizontal overflow, clipping, or misleading controls.

## Resolved blockers

## 2026-08-23: Configured Base RPC scan recovered

Status: Resolved

The local server returned healthy and sanitized configuration responses. A new
`POST /api/scans` completed against Base block `41105890` with one
informational alert, complete evidence, and zero failures. Alert list and detail
retrieval also passed.

Decision needed: None.
