# Hadron Guide


End-to-end examples for the [Hadron AMM](https://hadron.fi) SDK on Solana. This repo ships a precompiled Hadron program binary (`programs/hadron.so`), a set of scripts that create a fully configured pool on devnet, and simulations that visualize depth curves and interpolation modes locally via LiteSVM. Try running the commands in order.
```
npm run init          Create pool on devnet (mints, curves, deposit)
      │                  ↳ saves pool address to output/pool-config.json
      ▼
npm run read          Inspect pool state (midprice, spread, curves, balances)
      │
      ▼
npm run write         Update midprice, spread, curves, execute swaps
      │
      ▼
npm run depth-curves  Simulate & visualize depth across 21 inventory levels
                         ↳ output/depth-curves.html
```

> To customize the pool, edit [`src/quickstart/01-initialize-pool.test.ts`](src/quickstart/01-initialize-pool.test.ts) and re-run `npm run init`.

## Key Concepts

Hadron pools expose **6 levers** for controlling pricing:

1. **Midprice**: oracle price pushed by the authority via `updateMidprice`
2. **Base spread**: symmetric bid/ask offset around midprice (e.g. 10 bps)
3. **Price curves**: price degradation as a function of trade size (depth)
4. **Risk curves**: price adjustment based on vault inventory imbalance
5. **Curve updates**: real-time curve edits queued via `submitCurveUpdates`, applied atomically on the next swap
6. **Spread triggers**: per-account spread overrides that automatically widen the bid/ask

## Key Files

### Quickstart | devnet pool lifecycle

| # | File | Description | Run |
|---|------|-------------|-----|
| 01 | [Initialize Pool](src/quickstart/01-initialize-pool.test.ts) | Creates a pool from scratch: mints, curves, deposit, midprice. Edit this file to customize the pool. | `npm run init` |
| 02 | [Read Pool State](src/quickstart/02-read-pool-state.test.ts) | Prints midprice, spread, decoded curve points, vault balances, and oracle state for an existing pool. | `npm run read` |
| 03 | [Write Pool Updates](src/quickstart/03-write-pool-updates.test.ts) | Updates midprice, base spread, and curve points on a live pool, then executes a swap. | `npm run write` |
| 04 | [Spread Config](src/quickstart/04-spread-config.test.ts) | Full spread trigger lifecycle: initialize, add/update/remove triggers, swap at each stage. | `npm run spread` |

### Simulations | local LiteSVM

| # | File | Description | Run |
|---|------|-------------|-----|
| 01 | [Depth Curves](src/simulations/01-depth-curves.test.ts) | Recreates the pool in LiteSVM at 21 inventory levels and generates an interactive depth chart. | `npm run depth-curves` |
| 02 | [Interpolation Comparison](src/simulations/02-interpolation-comparison.test.ts) | Compares Step, Linear, Hyperbolic, Quadratic, and Cubic interpolation on the same control points. | `npm run interp` |

Run all: `npm test`

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

The defaults work out of the box, pointing to devnet with `./wallet.json`:

```
NETWORK=devnet
WALLET=./wallet.json
RPC_URL=https://api.devnet.solana.com
```

If you have a custom RPC endpoint (e.g. Helius, Triton), set `RPC_URL` in `.env`.

## Quick Start

Run these commands **in order**. Each step builds on the previous one.

```bash
# 1. Create a pool on devnet | mints two tokens, sets curves, deposits liquidity
#    Saves pool address + authority keypair to output/pool-config.json
npm run init

# 2. Read pool state | midprice, spread, active curves, vault balances
POOL=<address> npm run read

# 3. Update the pool | change midprice, spread, edit curves, execute a swap
POOL=<address> npm run write

# 4. Configure spread triggers | add/update/remove triggers, swap at different widths
POOL=<address> npm run spread

# 5. Simulate depth curves across 21 inventory levels (runs locally in LiteSVM)
npm run depth-curves        # → output/depth-curves.html

# 6. Compare 5 interpolation modes on the same control points (runs locally in LiteSVM)
npm run interp              # → output/interp-comparison.html
```

## Output Files

All examples write to `output/`:

| File | Created by | Description |
|------|-----------|-------------|
| `pool-config.json` | `npm run init` | Array of pool configs (address, authority, timestamp). Tests 02-04 read the **latest entry**. |
| `authority-{addr}.json` | `npm run init` | Authority keypair for each pool (needed for write operations) |
| `depth-curves.html` | `npm run depth-curves` | Interactive depth chart with inventory slider |
| `interp-comparison.html` | `npm run interp` | Side-by-side interpolation mode comparison |

You can run `npm run init` multiple times: each run appends a new pool to `pool-config.json`. Subsequent commands (`read`, `write`, `spread`, `depth-curves`) always use the most recent pool.
