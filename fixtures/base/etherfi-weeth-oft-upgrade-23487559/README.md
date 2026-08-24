# ether.fi Base weETH OFT upgrade fixture

This fixture captures one selected log from Base block `23487559` and
transaction
`0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2`.
It is intentionally a curated subset, not a complete RPC receipt.

The configured Alchemy Base archive RPC independently reproduced chain ID
`8453`, the block and transaction identity, successful receipt, matching
`Upgraded(address)` log, implementation slot at blocks `23487558` and
`23487559`, implementation bytecode at `23487559`, and `endpoint()`, `token()`,
and `sharedDecimals()` at `23487559` on 2026-08-24. No current-state reads,
proxy discovery, arbitrary calls, or explorer APIs were used as fixture
evidence.

Sources:

- https://basescan.org/tx/0x8e5e5ea61db41bc1f403552c7303324c37d50406d40ef02e10a1b634f535dfe2
- https://basescan.org/block/23487559
- https://github.com/etherfi-protocol/weETH-cross-chain

The fixture proves only the fixed Base-side proxy upgrade and six configured
historical checks. It does not establish the safety of remote peers, DVNs,
executors, SyncPool operations, Layer 1 backing paths, ownership changes,
transfers, pauses, or unpauses.
