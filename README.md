# Hadron Examples

SDK usage examples for the [Hadron AMM](https://hadron.fi) on Solana.

## Quick Start

```bash
npm install

# 1. Create a pool on devnet (writes config to output/)
NETWORK=devnet WALLET=./wallet.json npm run init

# 2. Read pool state — midprice, spread, curves, vault balances
NETWORK=devnet WALLET=./wallet.json npm run read

# 3. Update midprice, spread, curves, and swap
NETWORK=devnet WALLET=./wallet.json npm run write

# 4. Configure spread triggers and swap at different spreads
NETWORK=devnet WALLET=./wallet.json npm run spread

# 5. Simulate depth curves across 21 inventory levels (local LiteSVM)
npm run depth-curves        # → output/depth-curves.html

# 6. Compare 5 interpolation modes on the same control points (local LiteSVM)
npm run interp              # → output/interp-comparison.html
```

## Key Concepts

Hadron pools expose **5 levers** that market makers use to control pricing:

1. **Midprice** — The oracle price (e.g. 150 USDC/token). Pushed by the authority via `updateMidprice`.

2. **Base spread** — A symmetric bid/ask offset applied around the midprice. For example, 10 bps means the bid sits at `mid × 0.999` and the ask at `mid × 1.001`.

3. **Price curves** — Define how price degrades with trade size (depth). Each side (bid/ask) has a curve mapping cumulative volume to a price factor. Larger trades get progressively worse prices.

4. **Risk curves** — Define how price adjusts based on vault inventory. When one side of the vault is depleted, the risk curve penalizes further trades in that direction, protecting the pool from imbalance.

5. **Curve updates** — Real-time curve edits queued via `submitCurveUpdates` and applied atomically during the next swap. This lets market makers adjust curves without separate on-chain transactions.

## Examples

### Quickstart — devnet pool lifecycle

| # | Example | What it demonstrates | Run |
|---|---------|---------------------|-----|
| 01 | [Initialize Pool](src/quickstart/01-initialize-pool.test.ts) | Create mints, initialize a pool, set price + risk curves, deposit liquidity, update midprice | `npm run init` |
| 02 | [Read Pool State](src/quickstart/02-read-pool-state.test.ts) | Load an existing pool and print midprice, spread, active curves, vault balances, and oracle state | `npm run read` |
| 03 | [Write Pool Updates](src/quickstart/03-write-pool-updates.test.ts) | `updateMidprice`, `updateBaseSpread`, `submitCurveUpdates`, and swaps on a live devnet pool | `npm run write` |
| 04 | [Spread Config](src/quickstart/04-spread-config.test.ts) | Initialize a spread config, add/update/remove spread triggers, and swap at different spread widths | `npm run spread` |

### Simulations — local LiteSVM

| # | Example | What it demonstrates | Run |
|---|---------|---------------------|-----|
| 01 | [Depth Curves](src/simulations/01-depth-curves.test.ts) | Recreate the pool in LiteSVM at 21 inventory levels, probe swap prices, generate interactive HTML visualization | `npm run depth-curves` |
| 02 | [Interpolation Comparison](src/simulations/02-interpolation-comparison.test.ts) | Compare Step, Linear, Hyperbolic, Quadratic, and Cubic interpolation modes on the same control points via probe swaps | `npm run interp` |

Run all examples:

```bash
npm test
```

## Configuration

Set these in `.env` or as environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORK` | `litesvm` | `litesvm` for local testing, `devnet` for live |
| `WALLET` | — | Path to keypair JSON (required for devnet) |
| `RPC_URL` | `https://api.devnet.solana.com` | Custom RPC endpoint |

See [`.env.example`](.env.example) for a template.
