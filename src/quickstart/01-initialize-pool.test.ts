/**
 * Example: Initialize a Hadron pool and configure price + risk curves.
 *
 * Walks through the full lifecycle:
 *   1. Initialize the pool
 *   2. Set price curves (bid + ask)
 *   3. Set risk curves (bid + ask)
 *   4. Deposit liquidity
 *   5. Update the midprice oracle
 *
 * Run locally (LiteSVM):
 *   npm test
 *
 * Run on devnet:
 *   NETWORK=devnet WALLET=./wallet.json npm test
 *
 * Custom RPC:
 *   NETWORK=devnet WALLET=./wallet.json RPC_URL=https://my-rpc.com npm test
 */
import { describe, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Hadron, toQ32, Interpolation, Side } from "@hadron-fi/sdk";
import { TestHarness, logTx, logInfo, logHeader } from "../setup";
import fs from "fs";
import path from "path";

describe("Initialize pool with price and risk curves", () => {
  it("creates a pool, sets curves, and deposits liquidity", async () => {
    const h = new TestHarness();

    // ---------------------------------------------------------------
    // 1. Create two token mints (X = base token, Y = quote token)
    // ---------------------------------------------------------------
    const mintX = Keypair.generate();
    const mintY = Keypair.generate();
    await h.createMint(mintX, 6);
    await h.createMint(mintY, 6);

    const authority = Keypair.generate();
    await h.airdrop(authority.publicKey, 10_000_000n); // 0.01 SOL for tx fees

    // ---------------------------------------------------------------
    // 2. Initialize the pool
    //    Hadron.initialize() returns the instructions + pool address.
    //    On a live network you'd use Hadron.load(connection, poolAddress)
    //    after confirmation. Here we use h.loadPool() as a shorthand.
    // ---------------------------------------------------------------
    const initialMidprice = 150.0; // e.g. 150 USDC per token

    const { instructions, poolAddress } = Hadron.initialize(
      h.payer.publicKey,
      {
        mintX: mintX.publicKey,
        mintY: mintY.publicKey,
        authority: authority.publicKey,
        initialMidpriceQ32: toQ32(initialMidprice),
        tokenProgramX: TOKEN_PROGRAM_ID,
        tokenProgramY: TOKEN_PROGRAM_ID,
      }
    );

    logHeader("Initialize pool");
    let sig = await h.sendIxs(instructions);
    logTx("Initialize", sig);
    logInfo("Pool address:", poolAddress.toBase58());

    // Load the pool object — on a live network: await Hadron.load(connection, poolAddress)
    const pool = await h.loadPool(poolAddress);

    // ---------------------------------------------------------------
    // 3. Set price curves (bid + ask)
    //
    //    Controls the effective price as a function of trade size.
    //    priceFactor is a multiplier on the midprice:
    //      Bid: < 1.0 = worse price for seller (amountIn in X atoms)
    //      Ask: > 1.0 = worse price for buyer (amountIn in Y atoms)
    //
    //    To get symmetric USD depth, ask amountIn values are scaled
    //    by midprice: 500 base-equiv = 500 * 150 = 75,000 Y tokens.
    // ---------------------------------------------------------------
    logHeader("Set price curves");
    sig = await h.sendIx(
      pool.setCurve(authority.publicKey, {
        side: Side.Bid,
        defaultInterpolation: Interpolation.Linear,
        slot: 0,
        points: [
          { amountIn: 0n, priceFactor: 1.0 },    // at midprice
          { amountIn: 500_000_000n, priceFactor: 0.995 },  // -0.5% at 500 X
          { amountIn: 1_000_000_000n, priceFactor: 0.98 },   // -2% at 1,000 X
        ],
      }),
      [authority]
    );
    logTx("Price curve (bid)", sig);

    sig = await h.sendIx(
      pool.setCurve(authority.publicKey, {
        side: Side.Ask,
        defaultInterpolation: Interpolation.Linear,
        slot: 0,
        points: [
          { amountIn: 0n, priceFactor: 1.0 },    // at midprice
          { amountIn: 75_000_000_000n, priceFactor: 1.005 },  // +0.5% at 75k Y (≈500 base-equiv)
          { amountIn: 150_000_000_000n, priceFactor: 1.02 },   // +2% at 150k Y (≈1,000 base-equiv)
        ],
      }),
      [authority]
    );
    logTx("Price curve (ask)", sig);

    // ---------------------------------------------------------------
    // 4. Set risk curves (bid + ask)
    //
    //    Adjusts pricing based on vault inventory imbalance.
    //    pctBase: 0.0 = vault empty, 1.0 = vault full.
    //    priceFactor < 1.0 penalizes trades that worsen imbalance.
    // ---------------------------------------------------------------
    logHeader("Set risk curves");
    sig = await h.sendIx(
      pool.setRiskCurve(authority.publicKey, {
        side: Side.Bid,
        defaultInterpolation: Interpolation.Linear,
        slot: 0,
        points: [
          { pctBase: 0.0, priceFactor: 0.90 },  // vault empty  -> 10% penalty
          { pctBase: 0.25, priceFactor: 0.97 },   // low inv      -> 3% penalty
          { pctBase: 0.5, priceFactor: 1.0 },    // balanced     -> no adjustment
          { pctBase: 1.0, priceFactor: 1.0 },    // full         -> no adjustment
        ],
      }),
      [authority]
    );
    logTx("Risk curve (bid)", sig);

    sig = await h.sendIx(
      pool.setRiskCurve(authority.publicKey, {
        side: Side.Ask,
        defaultInterpolation: Interpolation.Linear,
        slot: 0,
        points: [
          { pctBase: 0.0, priceFactor: 1.0 },    // Y empty      -> no adjustment
          { pctBase: 0.5, priceFactor: 1.0 },     // balanced     -> no adjustment
          { pctBase: 0.75, priceFactor: 0.97 },    // Y filling up -> 3% penalty
          { pctBase: 1.0, priceFactor: 0.90 },    // Y full       -> 10% penalty
        ],
      }),
      [authority]
    );
    logTx("Risk curve (ask)", sig);

    // ---------------------------------------------------------------
    // 5. Deposit liquidity
    // ---------------------------------------------------------------
    logHeader("Deposit liquidity");
    await h.createAta(pool.addresses.config, mintX.publicKey);
    await h.createAta(pool.addresses.config, mintY.publicKey);

    const userAtaX = await h.createAta(authority.publicKey, mintX.publicKey);
    const userAtaY = await h.createAta(authority.publicKey, mintY.publicKey);
    await h.mintTo(mintX.publicKey, userAtaX, 10_000_000_000n);
    await h.mintTo(mintY.publicKey, userAtaY, 10_000_000_000n);

    sig = await h.sendIx(
      pool.deposit(authority.publicKey, {
        amountX: 5_000_000_000n, // 5,000 tokens each side
        amountY: 5_000_000_000n,
        expiration: Math.floor(Date.now() / 1000) + 3600,
      }),
      [authority]
    );
    logTx("Deposit 5,000 X + 5,000 Y", sig);

    // ---------------------------------------------------------------
    // 6. Update the midprice oracle
    //    The authority can push price updates at any time.
    // ---------------------------------------------------------------
    logHeader("Update midprice oracle");
    sig = await h.sendIx(
      pool.updateMidprice(authority.publicKey, {
        midpriceQ32: toQ32(152.5),
      }),
      [authority]
    );
    logTx("Midprice -> 152.5", sig);

    // ---------------------------------------------------------------
    // 7. Save pool config to JSON
    //    Appends a new entry to output/pool-config.json (array).
    //    Other tests use the most recent entry.
    //    Authority keypair is saved as a separate file.
    // ---------------------------------------------------------------
    logHeader("Save pool config");
    const outputDir = path.resolve(__dirname, "../../output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Save authority keypair to its own file
    const authorityKeyFile = `authority-${poolAddress.toBase58().slice(0, 8)}.json`;
    fs.writeFileSync(
      path.join(outputDir, authorityKeyFile),
      JSON.stringify(Array.from(authority.secretKey))
    );

    const entry = {
      poolAddress: poolAddress.toBase58(),
      authority: authority.publicKey.toBase58(),
      authorityKeyFile,
      createdAt: new Date().toISOString(),
    };

    // Append to existing array or create new one
    const configPath = path.join(outputDir, "pool-config.json");
    const existing = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
      : [];
    const pools = Array.isArray(existing) ? existing : [existing];
    pools.push(entry);
    fs.writeFileSync(configPath, JSON.stringify(pools, null, 2));
    logInfo("Config appended:", "output/pool-config.json");
    logInfo("Authority key:", `output/${authorityKeyFile}`);

    logHeader("Pool is live and ready for swaps!");
    logInfo("Pool address:", pool.poolAddress.toBase58());
  });
});
