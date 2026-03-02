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

**[01 - Initialize Pool](src/quickstart/01-initialize-pool.test.ts)** | `npm run init`

Full pool creation from scratch. This is the file to edit when customizing the pool.
1. Creates two SPL token mints (X = base, Y = quote, both 6 decimals)
2. Airdrops SOL to a new authority keypair
3. Initializes the pool with a $150 midprice
4. Sets 11-point bid + ask price curves (linear interpolation, kinked at 750 X)
5. Sets 5-point bid + ask risk curves for inventory rebalancing
6. Deposits 5,000 X + 750,000 Y (50/50 value split)
7. Updates the midprice oracle to $152.50
8. Saves pool address + authority keypair to `output/pool-config.json`

**[02 - Read Pool State](src/quickstart/02-read-pool-state.test.ts)** | `POOL=<address> npm run read`

Read-only inspection of an existing pool. Prints:
- Midprice, base spread, and oracle metadata
- Active curve slots with decoded points and interpolation modes
- Vault balances for both tokens

**[03 - Write Pool Updates](src/quickstart/03-write-pool-updates.test.ts)** | `POOL=<address> npm run write`

Live parameter updates on a running pool. Demonstrates the SDK methods market makers use in production:
1. `updateMidprice`: push a new oracle price
2. `updateBaseSpread`: widen or narrow the base spread
3. `updateMidpriceAndBaseSpread`: atomic update of both
4. `submitCurveUpdates`: queue point-level edits to the price curve
5. `swap`: executes a swap (pending curve edits apply atomically during the swap)

**[04 - Spread Config](src/quickstart/04-spread-config.test.ts)** | `POOL=<address> npm run spread`

Spread trigger lifecycle. Shows how to dynamically widen spreads for specific accounts:
1. Initialize a spread config on the pool
2. Add spread triggers via `addSpreadTriggers` (additive merge)
3. Update and remove individual triggers
4. Full replacement via `updateSpreadConfig`
5. Swaps at each stage to show the effect on pricing

### Simulations | local LiteSVM

**[01 - Depth Curves](src/simulations/01-depth-curves.test.ts)** | `npm run depth-curves`

Visualizes how the pool's depth changes across inventory levels. Loads curve config from your devnet pool, recreates it in LiteSVM at 21 inventory levels (5% to 95%), probes swap prices at increasing trade sizes, and generates an interactive HTML chart with an inventory slider. Output: `output/depth-curves.html`

**[02 - Interpolation Comparison](src/simulations/02-interpolation-comparison.test.ts)** | `npm run interp`

Side-by-side comparison of all 5 interpolation modes (Step, Linear, Hyperbolic, Quadratic, Cubic) using the same control points. Runs probe swaps for each mode and generates a multi-panel HTML chart. Output: `output/interp-comparison.html`

---

Run all examples: `npm test`

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
