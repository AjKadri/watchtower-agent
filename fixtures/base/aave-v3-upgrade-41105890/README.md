# Aave V3 Base core upgrade fixture

This fixture captures one selected log from Base block `41105890` and transaction
`0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a`.
It is intentionally a curated subset, not a complete RPC receipt.

The block identity, transaction sender and recipient, successful receipt,
emitting contract, log index, topics, and decoded address were checked against
live Base RPC and BaseScan on 2026-08-22. The contract role was checked against
the official Aave address book.

The fixture records that implementation bytecode was present with a length of
`22757` bytes. It does not record a bytecode hash. Final provenance verification
on 2026-08-26 could not reproduce the historical code read because the
configured archive RPC hostname did not resolve, so the previously unsupported
frontend-only hash was removed.

Sources:

- https://basescan.org/tx/0x748f1885704560973c376f4a679be5bd01fec8e93c3f179ded177860f8dac47a
- https://basescan.org/block/41105890
- https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol

The fixture supports only `Upgraded(address)` from the configured Pool proxy. It
does not prove ownership, large-transfer, pause, or unpause support.
