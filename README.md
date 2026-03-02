# Hadron Examples


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

Run these commands **in order**. Each step builds on the previous one.

```bash
# 1. Create a pool on devnet — mints two tokens, sets curves, deposits liquidity
#    Saves pool address + authority keypair to output/pool-config.json
npm run init

# 2. Read pool state — midprice, spread, active curves, vault balances
POOL=<address> npm run read

# 3. Update the pool — change midprice, spread, edit curves, execute a swap
POOL=<address> npm run write

# 4. Configure spread triggers — add/update/remove triggers, swap at different widths
POOL=<address> npm run spread

# 5. Simulate depth curves across 21 inventory levels (runs locally in LiteSVM)
npm run depth-curves        # → output/depth-curves.html

# 6. Compare 5 interpolation modes on the same control points (runs locally in LiteSVM)
npm run interp              # → output/interp-comparison.html
```

## Default Pool Configuration

The pool created by `npm run init` uses these defaults. To change them, edit [`src/quickstart/01-initialize-pool.test.ts`](src/quickstart/01-initialize-pool.test.ts).

| Parameter | Default | Notes |
|-----------|---------|-------|
| Midprice | **$150.00** | Updated to $152.50 at the end |
| Token X (base) | 6 decimals | New mint each run |
| Token Y (quote) | 6 decimals | New mint each run |
| Deposit | **5,000 X + 750,000 Y** | 50/50 value at $150 ($750k per side) |
| Interpolation | Linear | All curves |

### Price Curves (bid + ask, 11 points each)

Both bid and ask use `priceFactor < 1.0` — this reduces swap output to create a spread. A kink at 750 X steepens the curve to protect liquidity at larger trade sizes.

| Trade Size | priceFactor | Spread (bps) |
|-----------|-------------|-------------|
| 0 (midprice) | 1.0 | 0 |
| 100 X | 0.99933 | -6.7 |
| 250 X | 0.99867 | -13.3 |
| 500 X | 0.99794 | -20.6 |
| **750 X** | **0.99244** | **-75.6 (kink)** |
| 1,000 X | 0.99206 | -79.4 |
| 2,000 X | 0.99106 | -89.4 |
| 4,000 X | 0.99000 | -100.0 |

Ask curve uses the same factors with amountIn scaled by midprice (e.g. 500 X-equiv = 75,000 Y).

### Risk Curves (bid + ask, 5 points each)

Adjusts pricing based on vault inventory to attract rebalancing flow.

| Inventory (% base) | Bid Factor | Ask Factor | Effect |
|--------------------|-----------|-----------|--------|
| 0% (empty) | 1.005 | 0.990 | Raise bid / lower ask to attract X inflow |
| 50% (balanced) | 1.0 | 1.0 | No adjustment |
| 100% (full) | 0.990 | 1.005 | Lower bid / raise ask to attract X outflow |

## Output Files

All examples write to `output/`:

| File | Created by | Description |
|------|-----------|-------------|
| `pool-config.json` | `npm run init` | Array of pool configs (address, authority, timestamp). Tests 02-04 read the **latest entry**. |
| `authority-{addr}.json` | `npm run init` | Authority keypair for each pool (needed for write operations) |
| `depth-curves.html` | `npm run depth-curves` | Interactive depth chart with inventory slider |
| `interp-comparison.html` | `npm run interp` | Side-by-side interpolation mode comparison |

You can run `npm run init` multiple times — each run appends a new pool to `pool-config.json`. Subsequent commands (`read`, `write`, `spread`, `depth-curves`) always use the most recent pool.

## Key Concepts

Hadron pools expose **5 levers** for controlling pricing:

1. **Midprice** — Oracle price pushed by the authority via `updateMidprice`.
2. **Base spread** — Symmetric bid/ask offset around midprice (e.g. 10 bps).
3. **Price curves** — Price degradation as a function of trade size (depth).
4. **Risk curves** — Price adjustment based on vault inventory imbalance.
5. **Curve updates** — Real-time curve edits queued via `submitCurveUpdates`, applied atomically on the next swap.

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
