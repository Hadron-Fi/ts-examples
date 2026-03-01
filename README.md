# Hadron Examples

SDK usage examples for the [Hadron AMM](https://hadron.fi) on Solana.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a wallet and fund it on devnet

```bash
# Generate a new keypair
solana-keygen new -o wallet.json

# Fund it with devnet SOL (run a few times if needed)
solana airdrop 5 --keypair wallet.json --url devnet
```

### 3. Configure environment

Copy the example env file and edit if needed:

```bash
cp .env.example .env
```

The defaults work out of the box — they point to devnet with `./wallet.json`:

```
NETWORK=devnet
WALLET=./wallet.json
RPC_URL=https://api.devnet.solana.com
```

If you have a custom RPC endpoint (e.g. Helius, Triton), set `RPC_URL` in `.env`.

## Quick Start

```bash
# 1. Create a pool on devnet (writes config to output/)
npm run init

# 2. Read pool state — midprice, spread, curves, vault balances
npm run read

# 3. Update midprice, spread, curves, and swap
npm run write

# 4. Configure spread triggers and swap at different spreads
npm run spread

# 5. Simulate depth curves across 21 inventory levels (local LiteSVM)
npm run depth-curves        # → output/depth-curves.html

# 6. Compare 5 interpolation modes on the same control points (local LiteSVM)
npm run interp              # → output/interp-comparison.html
```

## Key Concepts

Hadron pools expose **5 levers** for controlling pricing:

1. **Midprice** - Oracle price pushed by the authority via `updateMidprice`.
2. **Base spread** - Symmetric bid/ask offset around midprice (e.g. 10 bps).
3. **Price curves** - Price degradation as a function of trade size (depth).
4. **Risk curves** - Price adjustment based on vault inventory imbalance.
5. **Curve updates** - Real-time curve edits queued via `submitCurveUpdates`, applied atomically on the next swap.

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

All configuration is via `.env` (loaded automatically by dotenv):

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORK` | `litesvm` | `litesvm` for local testing, `devnet` for live |
| `WALLET` | — | Path to keypair JSON (required for devnet) |
| `RPC_URL` | `https://api.devnet.solana.com` | Custom RPC endpoint |

See [`.env.example`](.env.example) for a template.
