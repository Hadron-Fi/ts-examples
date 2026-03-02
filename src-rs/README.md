# Rust Examples

All commands run from the project root (`hadron-examples/`).

```
cargo run --bin init              Create pool on devnet (mints, curves, deposit)
      │                            ↳ saves pool address to output/pool-config.json
      ▼
cargo run --bin read              Inspect pool state (midprice, spread, curves, balances)
      │
      ▼
cargo run --bin write             Update midprice, spread, curves, execute swaps
      │
      ▼
cargo run --bin spread-config     Configure spread triggers, swap at different widths
      │
      ▼
cargo run --bin delta-staleness   Configure delta staleness
```

Point at a specific pool: `POOL=<address> cargo run --bin read`

## Files

| # | File | Description |
|---|------|-------------|
| 01 | [Init Pool](quickstart/01-init-pool.rs) | Creates a pool from scratch: mints, curves, deposit, midprice. |
| 02 | [Read Pool](quickstart/02-read-pool.rs) | Reads and prints all pool state from devnet. |
| 03 | [Write Pool](quickstart/03-write-pool.rs) | Updates midprice, base spread, curve points, and executes swaps. |
| 04 | [Spread Config](quickstart/04-spread-config.rs) | Full spread trigger lifecycle: initialize, add/update/remove triggers, swap at each stage. |
| 05 | [Delta Staleness](quickstart/05-delta-staleness.rs) | Set and reset delta staleness on the pool config. |

[`setup.rs`](setup.rs) contains shared helpers (wallet loading, RPC client, token ops, logging).

## How it works

Uses [`hadron-sdk`](https://crates.io/crates/hadron-sdk) (Rust SDK) with the `rpc` feature for on-chain reads and writes via `solana-client`.

**Three keys, three roles:**

| Key | File | Role |
|-----|------|------|
| Payer | `wallet.json` | Pays SOL for tx fees and rent. Mint authority for test tokens. |
| Authority | `output/authority-*.json` | Pool authority — signs pool operations. Generated per pool by init. |
| User | Same as Authority | Acts as the trader in swap/deposit examples. |
