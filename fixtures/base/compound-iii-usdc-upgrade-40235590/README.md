# Compound III Base USDC Comet upgrade fixture

This fixture captures one selected log from Base block `40235590` and
transaction
`0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4`.
It is intentionally a curated subset, not a complete RPC receipt.

The configured Alchemy Base archive RPC independently reproduced chain ID
`8453`, the block and transaction identity, successful receipt, matching
`Upgraded(address)` log, implementation slot at blocks `40235589` and
`40235590`, implementation bytecode at `40235590`, `governor()` at both fixed
blocks, and `baseToken()` at `40235590` on 2026-08-24. No current-state reads,
proxy discovery, arbitrary calls, or explorer APIs were used as fixture
evidence.

Sources:

- https://basescan.org/tx/0x5de36ea4daf596890b2f0f3696547bda11090d16c9eaf8f2d35bb4b4ca13f1f4
- https://basescan.org/block/40235590
- https://github.com/compound-finance/comet/blob/main/deployments/base/usdc/roots.json

The fixture proves only the fixed proxy upgrade and six configured historical
checks. It does not prove governance intent, proposal correctness, full market
configuration safety, ownership changes, transfers, pauses, or unpauses.
