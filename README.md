# Watchtower

Watchtower is being developed as an evidence-backed Base incident monitoring
agent.

Watchtower provides a deterministic, read-only evidence pipeline and minimal
investigation dashboard for one verified Aave V3 Base Pool proxy upgrade. It
contains validated configuration, strict event decoding, normalized records,
structured failures, an Express API, and a vanilla browser interface. It does
not contain continuous monitoring, notifications, authentication, wallet access,
a database, deployment infrastructure, or LLM integration.

## Start here

Before making changes:

1. Read `AGENTS.md`.
2. Read `.agent/TASK.md`, `.agent/STATUS.md`, `.agent/DECISIONS.md`, and `.agent/BLOCKERS.md`.
3. Inspect the Git status and history.
4. Work only within the approved task scope.
5. Validate the milestone, update `.agent/STATUS.md`, and commit it with a Conventional Commit message.

## Reproducible setup

Requirements:

- Node.js 24 or newer
- npm

From a clean clone, run:

```sh
npm --version
node --version
npm install
cp .env.example .env
npm test
npm run typecheck
```

The verified environment used Node.js `v24.15.0` and npm `11.12.1`.
`npm install` added 144 packages and reported zero vulnerabilities. The committed
lockfile is the dependency source of truth.

Start the local server:

```sh
npm run dev
```

Open http://localhost:3000. The dashboard starts with an empty in-memory alert
list. Select `Run verified scan` to request the approved historical scan.

## Opt-in live demo scan

The safe example uses the public read-only endpoint
`https://base-mainnet.public.blastapi.io`. Copy `.env.example` to `.env` before
running the command. Never place a credentialed RPC URL in a committed file or
shared command output.

Run the fixed historical scan:

```sh
npm run scan
```

The equivalent one-command form is:

```sh
BASE_RPC_URL=https://base-mainnet.public.blastapi.io npm run scan
```

The command scans only block `41105890`. It writes the structured result to
standard output and exits with a nonzero status if the scan fails. The endpoint
is not embedded in application code, and no scan runs unless this command is
invoked.

Expected verified result:

- scan status: `complete`
- alert ID: `alert_f2cdc9894350f2e6cd280508dad9edb4d63707c5cc6efdeb2c8d53aab7812c3e`
- severity: `informational`
- severity rule: `target-is-approved`
- evidence status: `complete`
- alerts: `1`
- failures: `0`

On 2026-08-23, the clean-clone CLI run completed in 3.96 seconds and the final
primary-workspace rerun completed in 3.03 seconds. A scan through the local API
completed in 2.268 seconds. These are single-run observations, not latency
guarantees. Public endpoint load and network conditions can change them.

## API

The server exposes:

- `GET /api/health`
- `GET /api/config`, containing sanitized public configuration only
- `POST /api/scans`, accepting only optional decimal `fromBlock` and `toBlock`
- `GET /api/scans/:scanId`
- `GET /api/alerts`
- `GET /api/alerts/:alertId`

Run the approved scan directly through the API:

```sh
curl -X POST -H 'content-type: application/json' --data '{}' http://localhost:3000/api/scans
```

Verify the documented local server without changing scan scope:

```sh
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3000/api/config
curl --fail -X POST -H 'content-type: application/json' --data '{}' http://localhost:3000/api/scans
curl --fail http://localhost:3000/api/alerts
```

The verified server returned HTTP 200 for the dashboard, stylesheet, browser
script, health, configuration, alert list, and alert detail. `POST /api/scans`
returned HTTP 201.

Scans, alerts, and evidence exist only in process memory and are cleared when
the server restarts. Repeating the scan recreates the same deterministic IDs.

## Supported target

The committed profile scans Base mainnet block `41105890` for one event from one
verified transaction:

- `Upgraded(address)` from the configured Aave V3 Base Pool proxy

The fixture contains selected logs and records its BaseScan and official Aave
address-book sources.

Known unsupported event types and cases:

- ownership and administrative changes
- pause and unpause events
- ERC-20 or native-asset large movements
- `PoolUpdated(address,address)` and other related-contract events
- arbitrary addresses, signatures, ABIs, custom events, and proxy patterns
- dynamic project discovery, transaction tracing, and fiat-value conversion

These exclusions are deliberate. The demo does not silently generalize beyond
the configured Pool proxy and `Upgraded(address)` event.

## Evidence pipeline

The synchronous scanner:

1. Validates the fixed target and requested bounds.
2. Reads the RPC chain ID and requires Base mainnet chain ID `8453`.
3. Checks the configured confirmation count.
4. Requests logs using the approved Pool address and upgrade topic.
5. Strictly decodes `Upgraded(address)`.
6. Retrieves the block, transaction, and receipt once per evidence key.
7. Requires the configured known transaction to produce complete qualifying
   event evidence before reporting `complete`.
8. Builds normalized evidence and applies the fixed severity policy.
9. Uses content-derived scan and alert IDs to prevent duplicates.

RPC, filter, decoding, and evidence failures remain visible in the JSON result.
An alert with missing block, transaction, receipt, or receipt-log evidence is
marked `incomplete` rather than discarded.

## Live evidence verification

The milestone 4 audit compared the complete record with live Base JSON-RPC data
through the public endpoint. All 26 checks passed.

| Evidence group | Verified value |
| --- | --- |
| Network | Base mainnet, chain ID `8453` |
| Confirmation check | More than 20 confirmations at verification time |
| Block | `41105890`, hash `0x3f8b9a19d39bdf97178f6f7e7117138ec5cb7c5fe292afcac914a250568428ff`, timestamp `2026-01-21T13:12:07.000Z` |
| Transaction | `0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a` |
| Sender | `0xd7e21e6debb75ceb4fc9d73c09ea48625984b959` |
| Recipient | `0xe226d5acae908252cca3f6cefa577527650a9e1e` |
| Receipt | success, transaction index `122`, matching block hash |
| Log | index `641`, emitting Pool proxy, matching receipt log |
| Event topic | `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b` |
| Decoded implementation | `0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4` |
| Severity | `informational` from `target-is-approved` |
| Evidence errors | none |

The topic is the hash of `Upgraded(address)`. The indexed implementation topic
decodes to the configured approved implementation. Both the emitting proxy and
implementation returned deployed bytecode. Configuration-derived fields, roles,
severity inputs, deterministic IDs, summaries, and limitations were checked
against `config/target.json` and the automated tests.

Every explorer link displayed for the complete alert returned HTTP 200:

- [transaction](https://basescan.org/tx/0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a)
- [block](https://basescan.org/block/41105890)
- [emitting Pool proxy](https://basescan.org/address/0xa238dd80c259a72e81d7e4664a9801593f98d1c5)
- [decoded implementation](https://basescan.org/address/0xDb578D67A83E94DE73c9e0C14280f804F6C1c3e4)

## RPC behavior and limitations

The verified working endpoint is
`https://base-mainnet.public.blastapi.io`. Watchtower requires historical
`eth_getLogs`, block, transaction, receipt, and latest-block access. Its viem
HTTP transport uses a 10-second request timeout, two retries, and a 250 ms retry
delay.

The endpoint is a shared public service with no availability or latency promise
from this repository. It may rate limit, time out, or become temporarily
unavailable. Watchtower surfaces those conditions as structured failures and
does not replace missing evidence with claims. Use a credentialed provider only
through the ignored local `.env` file.

## Partial and failed scans

Automated tests verify all three scan states:

- `complete`: the approved log and all evidence are available
- `partial`: a bounded chunk succeeds but strict decoding or evidence retrieval
  fails, the known event is absent, or the known transaction lacks complete
  evidence; supported alerts remain visible and incomplete evidence explains gaps
- `failed`: validation, latest-block access, or every bounded log chunk fails;
  alerts and evidence are empty and structured failures remain visible

A forced unreachable RPC produced `status: failed`,
`code: latest-block-rpc-failed`, no alerts, no evidence, and process exit code 1.
The result did not expose the endpoint or a stack trace.

## Investigation output

Each alert separates:

- observed facts copied from its evidence record
- deterministic interpretation tied to the displayed severity rule
- limitations that prevent the address comparison from being read as a claim
  about identity, intent, causality, or implementation safety

The dashboard shows the severity rule, evidence status, transaction, receipt,
block, log, decoded implementation, and direct BaseScan links. Scan failures and
incomplete-evidence errors remain visible rather than being replaced by a
generated explanation.

## Configuration

Non-secret target settings live in `config/target.json`. The server and CLI read
`BASE_RPC_URL` from a local `.env` file and default
`WATCHTOWER_CONFIG_PATH` to the committed target file.

Keep real values in ignored local environment files. Never commit secrets or
place RPC credentials in target configuration or fixtures.

`.env` and `.env.*` are ignored, while `.env.example` remains tracked. The
private handoff directory `.agent/private/` is also ignored. The public API
configuration is assembled from safe fields and does not expose `BASE_RPC_URL`.

## Verified milestone 4 commands

The following commands passed from a clean clone on 2026-08-23:

```sh
npm install
npm test
npm run typecheck
npm run scan
npm audit --audit-level=moderate
npm run dev
```

Results: 6 test files passed, 21 tests passed, TypeScript reported no errors,
the live scan reproduced one complete informational alert, and npm audit found
zero vulnerabilities.
