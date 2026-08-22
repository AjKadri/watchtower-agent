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

## Setup

Requirements:

- Node.js 24 or newer
- npm

Install and validate:

```sh
npm install
npm test
npm run typecheck
```

Copy the safe public example configuration and start the local server:

```sh
cp .env.example .env
npm run dev
```

Open http://localhost:3000. The dashboard starts with an empty in-memory alert
list. Select `Run verified scan` to request the approved historical scan.

## Opt-in live demo scan

Copy `.env.example` to `.env` and set `BASE_RPC_URL` to a read-only Base mainnet
HTTP RPC URL. Never use a URL containing credentials in a committed file or
shared command output.

Run the fixed historical scan:

```sh
npm run scan
```

For a temporary public endpoint, the equivalent one-command form is:

```sh
BASE_RPC_URL=https://base-mainnet.public.blastapi.io npm run scan
```

The command scans only block `41105890`. It writes the structured result to
standard output and exits with a nonzero status if the scan fails. The endpoint
is not embedded in application code, and no scan runs unless this command is
invoked.

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

Scans, alerts, and evidence exist only in process memory and are cleared when
the server restarts. Repeating the scan recreates the same deterministic IDs.

## Supported target

The committed profile scans Base mainnet block `41105890` for one event from one
verified transaction:

- `Upgraded(address)` from the configured Aave V3 Base Pool proxy

The fixture contains selected logs and records its BaseScan and official Aave
address-book sources. Ownership changes, administrative events, large transfers,
pause events, unpause events, related contracts, arbitrary addresses, and
arbitrary signatures are excluded.

## Evidence pipeline

The synchronous scanner:

1. Validates the fixed target and requested bounds.
2. Checks the configured confirmation count.
3. Requests logs using the approved Pool address and upgrade topic.
4. Strictly decodes `Upgraded(address)`.
5. Retrieves the block, transaction, and receipt once per evidence key.
6. Builds normalized evidence and applies the fixed severity policy.
7. Uses content-derived scan and alert IDs to prevent duplicates.

RPC, filter, decoding, and evidence failures remain visible in the JSON result.
An alert with missing block, transaction, receipt, or receipt-log evidence is
marked `incomplete` rather than discarded.

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
