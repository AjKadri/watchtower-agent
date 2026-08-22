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

### 2026-08-23: Revised SOC console needs rendered verification

Status: Active

The in-app browser runtime reported no available browser connection. Automated
tests, JavaScript syntax, TypeScript, asset delivery, and API checks passed, but
the revised layout has not been inspected at desktop or 390px widths.

Required resolution: Connect an in-app browser and verify empty, populated, and
failure states without horizontal overflow, clipping, or misleading controls.

### 2026-08-23: Configured Base RPC failed the live bounded scan

Status: Active

The local server started and returned healthy and sanitized configuration
responses. `POST /api/scans` returned a visible `latest-block-rpc-failed`
failure before scanning block `41105890` because the configured RPC could not
return the latest Base block.

Required resolution: Confirm the local `BASE_RPC_URL` is reachable and supports
the required Base JSON-RPC methods, then rerun the documented bounded scan.
