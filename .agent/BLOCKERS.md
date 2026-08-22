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

## 2026-08-22: Rendered dashboard verification needs a browser connection

Status: Active

Affected task: Watchtower MVP milestone 3, investigation and interface.

The server, dashboard assets, API routes, and live API scan were verified on
`http://localhost:3000`. The configured browser workflow reported that no
browser backend was available, so responsive layout, rendered content, and
interactive scan behavior could not be visually inspected in a real browser.

Decision needed: Connect an available browser and complete visual verification
before declaring milestone 3 fully verified or beginning milestone 4.
