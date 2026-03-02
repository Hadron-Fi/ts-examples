# Hadron Guide

End-to-end examples for the [Hadron AMM](https://hadron.fi) SDK on Solana in both **TypeScript** and **Rust**. Create a fully configured pool on devnet, inspect and update it, then simulate and visualize depth curves locally.

| | Guide | Examples |
|---|-------|---------|
| **TypeScript** | [src-ts/README.md](src-ts/README.md) | Quickstart + LiteSVM simulations |
| **Rust** | [src-rs/README.md](src-rs/README.md) | Quickstart (devnet reads & writes) |

Both languages share the same `output/` directory — you can create a pool in TS and read it in Rust, or vice versa.

## Key Concepts

Hadron pools expose **6 levers** for controlling pricing:

1. **Midprice**: oracle price pushed by the authority via `updateMidprice`
2. **Base spread**: symmetric bid/ask offset around midprice (e.g. 10 bps)
3. **Price curves**: price degradation as a function of trade size (depth)
4. **Risk curves**: price adjustment based on vault inventory imbalance
5. **Curve updates**: real-time curve edits queued via `submitCurveUpdates`, applied atomically on the next swap
6. **Spread triggers**: per-account spread overrides that automatically widen the bid/ask

## Setup

### 1. Create a wallet and fund it on devnet

```bash
solana-keygen new -o wallet.json
solana airdrop 5 --keypair wallet.json --url devnet
```

### 2. Configure environment

```bash
cp .env.example .env
```

Defaults work out of the box:

```
NETWORK=devnet
WALLET=./wallet.json
RPC_URL=https://api.devnet.solana.com
```

Set `RPC_URL` if you have a custom endpoint (Helius, Triton, etc).

### 3. System prerequisites

**Linux (Ubuntu/Debian):**

```bash
sudo apt update && sudo apt install build-essential pkg-config libssl-dev -y
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

**macOS:** Install Xcode Command Line Tools (`xcode-select --install`) and Rust via [rustup](https://rustup.rs).

### 4. Install dependencies

```bash
npm install           # TypeScript
cargo build           # Rust (optional, builds on first run)
```

## Quick Start

Run in order — each step builds on the previous one.

| Step | TypeScript | Rust |
|------|-----------|------|
| Create pool | `npm run init` | `cargo run --bin init` |
| Read state | `npm run read` | `cargo run --bin read` |
| Update & swap | `npm run write` | `cargo run --bin write` |
| Spread triggers | `npm run spread` | `cargo run --bin spread-config` |
| Delta staleness | `npm run delta-staleness` | `cargo run --bin delta-staleness` |
| Depth curves | `npm run depth-curves` | — |
| Interpolation modes | `npm run interp` | — |

Point at a specific pool: `POOL=<address> npm run read` or `POOL=<address> cargo run --bin read`

## Output Files

All examples write to `output/`:

| File | Created by | Description |
|------|-----------|-------------|
| `pool-config.json` | init | Array of pool configs (address, authority, timestamp) |
| `authority-{addr}.json` | init | Authority keypair for each pool |
| `sim-cache.json` | depth-curves / interp | Cached pool + fee config from devnet |
| `depth-curves.html` | depth-curves | Interactive depth chart with inventory slider |
| `interp-comparison.html` | interp | Side-by-side interpolation mode comparison |

You can run init multiple times — each run appends a new pool. Subsequent commands always use the most recent pool.
