# Watchtower

Watchtower is being developed as an evidence-backed Base incident monitoring
agent.

Milestone 1 defines one narrow target profile for a verified Aave V3 Base core
upgrade. It contains validated configuration, exact event ABI fragments,
normalized alert and evidence schemas, and curated fixtures. It does not contain
an RPC scanner, API, dashboard, or continuous monitor.

## Start here

Before making changes:

1. Read `AGENTS.md`.
2. Read `.agent/TASK.md`, `.agent/STATUS.md`, `.agent/DECISIONS.md`, and `.agent/BLOCKERS.md`.
3. Inspect the Git status and history.
4. Work only within the approved task scope.
5. Validate the milestone, update `.agent/STATUS.md`, and commit it with a Conventional Commit message.

## Milestone 1 setup

Requirements:

- Node.js 24 or newer
- npm

Install and validate:

```sh
npm install
npm test
npm run typecheck
```

There is no application run command in milestone 1. The approved future command
is `npm run dev`, which will be added only when the application server exists.

## Supported target

The committed profile scans Base mainnet block `41105890` for two events from
one verified transaction:

- `Upgraded(address)` from the configured Aave V3 Base Pool proxy
- `PoolUpdated(address,address)` from its configured PoolAddressesProvider

The fixture contains selected logs and records its BaseScan and official Aave
address-book sources. Large transfers, pause events, unpause events, arbitrary
addresses, and arbitrary signatures are excluded.

## Configuration

Non-secret target settings live in `config/target.json`. The future RPC client
will read `BASE_RPC_URL` from a local `.env` file and default
`WATCHTOWER_CONFIG_PATH` to the committed target file. No RPC call is made in
milestone 1.

Keep real values in ignored local environment files. Never commit secrets or
place RPC credentials in target configuration or fixtures.
