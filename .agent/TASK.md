# Active Task

## Objective

Build a narrow, reproducible Watchtower MVP for the Orion Agents Builder Hackathon.

Watchtower will scan a bounded historical block range for one server-selected
profile from a closed registry of three approved Base targets. It will detect
supported high-signal events, investigate each event using read-only onchain
data, and produce alerts whose factual claims can be independently verified.

Each target profile must name one primary contract and may name related
treasury, liquidity, proxy, provider, endpoint, or token addresses individually.
Watchtower must not discover or monitor an open-ended project graph in this MVP.

## Implementation gate

Do not start application implementation until the following choices are recorded in `.agent/DECISIONS.md`:

1. Base network and chain ID.
2. Primary contract address and the purpose of every related address.
3. A bounded demo block range and known qualifying transactions.
4. Exact event signatures supported for the selected target.
5. Large-transfer asset, watched addresses, threshold, and threshold units.
6. Deterministic severity rules with an example for each severity.
7. Technology stack and local run command.

If the selected target does not contain a real historical example for every required event class, narrow the event classes or select a different target. Do not fabricate demo events or imply broader contract support.

## Supported incident classes

Only signatures explicitly approved for the target profile are in scope:

1. Ownership or administrative changes.
2. Contract upgrades or pause and unpause events.
3. Large token or native-asset movements involving configured treasury or liquidity addresses.

Custom events, fiat-value conversion, inferred project relationships, and unsupported proxy or access-control patterns are out of scope unless added through a recorded decision.

## Evidence and investigation contract

For each candidate event, Watchtower must use read-only Base data to retrieve and preserve:

- network and chain ID
- block number, block hash, and timestamp
- transaction hash and log index
- emitting contract and relevant actor or destination addresses
- event signature and decoded arguments
- the configured detection rule and threshold, when applicable
- severity and the deterministic rule that produced it
- a concise explanation limited to facts supported by the collected evidence
- direct explorer links to the transaction, block, and relevant addresses
- an explicit error or incomplete-evidence state when required data cannot be retrieved
- a replay receipt whose ID is independently recomputed from its canonical
  payload and whose trigger, plan, checks, disposition, and explorer links agree
  with the containing evidence and investigation records

Explanations must distinguish observed facts from interpretation. The app must not invent identities, intent, causality, or risk claims that the evidence does not support.

## MVP constraints

- Use read-only blockchain access and never request a private key.
- Scan a configured historical block range for the demo.
- Support only the three approved target profiles and their fixed event signatures.
- Keep classification deterministic and testable.
- Keep secrets server-side and out of logs, browser bundles, fixtures, and Git.
- Surface RPC, decoding, and incomplete-evidence failures instead of silently dropping them.
- Do not send transactions or manage user funds.
- Do not add continuous monitoring, notifications, authentication, multi-project support, generalized threat detection, or deployment infrastructure in this task.

## Milestones

### 1. Target and contract definition

- Resolve every implementation-gate decision.
- Define the target profile, normalized alert schema, and severity rules.
- Add representative fixtures from verified Base transactions.

### 2. Deterministic evidence pipeline

- Connect to the configured Base RPC endpoint.
- Scan the approved bounded block range.
- Decode only supported events.
- Collect evidence and emit normalized alerts.
- Add tests for parsing, classification, failure states, and duplicate prevention.

### 3. Investigation and interface

- Produce evidence-bounded explanations.
- Show a minimal alert list and alert detail view.
- Make every evidence item easy to verify through its source link.

### 4. Demo hardening

- Run the documented demo scan against the approved historical range.
- Verify setup from a clean checkout.
- Record latency, RPC limitations, known unsupported cases, and real test results.

Complete and commit each milestone separately. Update `.agent/STATUS.md` after every milestone.

## Acceptance criteria

- [ ] All implementation-gate decisions are recorded before application code is added.
- [ ] A clean checkout can connect to the selected Base network using documented configuration.
- [ ] A bounded demo scan reproduces the approved historical incidents.
- [ ] Detection is limited to the target profile and supported signatures.
- [ ] Large movements use the configured asset, watched addresses, threshold, and units.
- [ ] Every alert satisfies the evidence and investigation contract.
- [ ] Missing or incomplete evidence is visible and never replaced with unsupported claims.
- [ ] Severity output identifies the deterministic rule that produced it.
- [ ] The interface provides a usable alert list and evidence detail view.
- [ ] Tests cover supported parsing, severity rules, failure states, and duplicate prevention.
- [ ] The README documents exact setup, configuration, supported scope, and demo commands.
- [ ] No private keys, credentials, or real secret values are committed.

## Verification

Before considering the MVP complete:

1. Start from a clean checkout and follow only the README.
2. Run the complete automated test suite and record the command and result.
3. Run the bounded demo scan and record the target, range, alerts, and failures.
4. Verify every displayed explorer link and evidence field against Base data.
5. Review the final diff for secrets, unsupported scope, and undocumented setup steps.

## Current next step

The first release-hardening batch is implemented. Scan HTTP outcomes now use
201 for complete, 200 for partial, 502 or 503 for upstream failure, and the
existing 400, 415, or 413 request statuses. ChainReader evidence responses are
runtime-validated and malformed candidate evidence is isolated. Production
startup uses compiled JavaScript in `dist/`. The documented production-only
clean-checkout install, build, health request, and graceful shutdown smoke test
passed on 2026-08-25.

The interface exposes no arbitrary target, call, address, plan, RPC URL, event,
or block input. Future work must preserve that boundary. Do not add dynamic ABI
loading, proxy discovery, multi-chain behavior, synthetic archive activity,
authentication, notifications, payments, persistence, or investigations beyond
the closed profile checks without a new recorded decision.
