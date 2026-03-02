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
 *   npm run init
 *
 * Run on devnet:
 *   NETWORK=devnet WALLET=./wallet.json npm run init
 *
 * Custom RPC:
 *   NETWORK=devnet WALLET=./wallet.json RPC_URL=https://my-rpc.com npm run init
 */
import { Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Hadron, toQ32, Interpolation, Side } from "@hadron-fi/sdk";
import { TestHarness, logTx, logInfo, logHeader, logExplorer } from "../setup";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const h = await TestHarness.create();

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
      maxPrefabSlots: 3,
      tokenProgramX: TOKEN_PROGRAM_ID,
      tokenProgramY: TOKEN_PROGRAM_ID,
    }
  );

  logHeader("Step 1 — Initialize pool");
  logInfo("Creating two token mints (X = base, Y = quote) with 6 decimals...", "");
  logInfo("Airdropping 0.01 SOL to the pool authority for tx fees...", "");
  let sig = await h.sendIxs(instructions);
  logTx("Initialize", sig);
  logInfo("Pool address:", poolAddress.toBase58());
  logExplorer("View on Solscan:", poolAddress.toBase58());

  // Load the pool object — on a live network: await Hadron.load(connection, poolAddress)
  const pool = await h.loadPool(poolAddress);

  // ---------------------------------------------------------------
  // 3. Set price curves (bid + ask)
  //
  //    Controls the effective price as a function of trade size.
  //    priceFactor is a multiplier on the swap output:
  //      Bid: < 1.0 = reduced output for seller (amountIn in X atoms)
  //      Ask: < 1.0 = reduced output for buyer (amountIn in Y atoms)
  //    Both sides use factors < 1.0 to create a spread.
  //
  //    Points define a depth curve with a kink at 750 X:
  //    smooth degradation up to 500 X, then +50 bps step.
  //
  //    A 50 bps kink at point 5 (750 X) steepens the curve beyond
  //    that threshold — protecting liquidity at larger trade sizes.
  //
  //    Ask amountIn values are scaled by midprice for symmetric
  //    USD depth: e.g. 500 base-equiv = 500 * 150 = 75,000 Y.
  // ---------------------------------------------------------------
  logHeader("Step 2 — Set price curves (bid + ask, 11 points each)");
  sig = await h.sendIx(
    pool.setCurve(authority.publicKey, {
      side: Side.Bid,
      defaultInterpolation: Interpolation.Linear,
      slot: 0,
      points: [
        { amountIn: 0n,               priceFactor: 1.0 },       // midprice
        { amountIn: 100_000_000n,     priceFactor: 0.99933 },   // 100 X
        { amountIn: 250_000_000n,     priceFactor: 0.99867 },   // 250 X
        { amountIn: 500_000_000n,     priceFactor: 0.99794 },   // 500 X
        { amountIn: 750_000_000n,     priceFactor: 0.99244 },   // 750 X   ← +50 bps kink
        { amountIn: 1_000_000_000n,   priceFactor: 0.99206 },   // 1,000 X
        { amountIn: 1_500_000_000n,   priceFactor: 0.99149 },   // 1,500 X
        { amountIn: 2_000_000_000n,   priceFactor: 0.99106 },   // 2,000 X
        { amountIn: 2_500_000_000n,   priceFactor: 0.99073 },   // 2,500 X
        { amountIn: 3_000_000_000n,   priceFactor: 0.99045 },   // 3,000 X
        { amountIn: 4_000_000_000n,   priceFactor: 0.99000 },   // 4,000 X  (-100 bps)
      ],
    }),
    [authority]
  );
  logTx("Price curve (bid — 11 points, 11 points, kinked)", sig);

  sig = await h.sendIx(
    pool.setCurve(authority.publicKey, {
      side: Side.Ask,
      defaultInterpolation: Interpolation.Linear,
      slot: 0,
      points: [
        { amountIn: 0n,                 priceFactor: 1.0 },       // midprice
        { amountIn: 15_000_000_000n,    priceFactor: 0.99933 },   // 15k Y  ≈ 100 X-equiv
        { amountIn: 37_500_000_000n,    priceFactor: 0.99867 },   // 37.5k  ≈ 250 X-equiv
        { amountIn: 75_000_000_000n,    priceFactor: 0.99794 },   // 75k    ≈ 500 X-equiv
        { amountIn: 112_500_000_000n,   priceFactor: 0.99244 },   // 112.5k ≈ 750 X  ← +50 bps kink
        { amountIn: 150_000_000_000n,   priceFactor: 0.99206 },   // 150k   ≈ 1,000 X-equiv
        { amountIn: 225_000_000_000n,   priceFactor: 0.99149 },   // 225k   ≈ 1,500 X-equiv
        { amountIn: 300_000_000_000n,   priceFactor: 0.99106 },   // 300k   ≈ 2,000 X-equiv
        { amountIn: 375_000_000_000n,   priceFactor: 0.99073 },   // 375k   ≈ 2,500 X-equiv
        { amountIn: 450_000_000_000n,   priceFactor: 0.99045 },   // 450k   ≈ 3,000 X-equiv
        { amountIn: 600_000_000_000n,   priceFactor: 0.99000 },   // 600k   ≈ 4,000 X-equiv (-100 bps)
      ],
    }),
    [authority]
  );
  logTx("Price curve (ask — 11 points, 11 points, kinked)", sig);

  // ---------------------------------------------------------------
  // 4. Set risk curves (bid + ask)
  //
  //    Adjusts pricing based on vault inventory imbalance.
  //    pctBase: 0.0 = vault empty, 1.0 = vault full.
  //
  //    Bid and ask are mirrors — they shift the effective fair price
  //    in parallel to attract rebalancing flow. At extremes, the
  //    spread also widens to protect against one-sided depletion.
  // ---------------------------------------------------------------
  logHeader("Step 3 — Set risk curves (bid + ask, 5 points each)");
  sig = await h.sendIx(
    pool.setRiskCurve(authority.publicKey, {
      side: Side.Bid,
      defaultInterpolation: Interpolation.Linear,
      slot: 0,
      points: [
        { pctBase: 0.0, priceFactor: 1.005 },   // low X  → raise bid to attract sellers
        { pctBase: 0.25, priceFactor: 1.0025 },
        { pctBase: 0.5, priceFactor: 1.0 },     // balanced → no adjustment
        { pctBase: 0.75, priceFactor: 0.9975 },
        { pctBase: 1.0, priceFactor: 0.990 },   // full X → lower bid to discourage more
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
        { pctBase: 0.0, priceFactor: 0.990 },   // low X  → lower ask to discourage buying
        { pctBase: 0.25, priceFactor: 0.9975 },
        { pctBase: 0.5, priceFactor: 1.0 },     // balanced → no adjustment
        { pctBase: 0.75, priceFactor: 1.0025 },
        { pctBase: 1.0, priceFactor: 1.005 },   // full X → raise ask to attract buyers
      ],
    }),
    [authority]
  );
  logTx("Risk curve (ask)", sig);

  // ---------------------------------------------------------------
  // 5. Deposit liquidity
  // ---------------------------------------------------------------
  logHeader("Step 4 — Deposit liquidity");
  await h.createAta(pool.addresses.config, mintX.publicKey);
  await h.createAta(pool.addresses.config, mintY.publicKey);

  const userAtaX = await h.createAta(authority.publicKey, mintX.publicKey);
  const userAtaY = await h.createAta(authority.publicKey, mintY.publicKey);
  await h.mintTo(mintX.publicKey, userAtaX, 10_000_000_000n);           // 10k X
  await h.mintTo(mintY.publicKey, userAtaY, 1_500_000_000_000n);        // 1.5M Y

  // 50/50 value deposit: 5,000 X ($750k) + 750,000 Y ($750k)
  sig = await h.sendIx(
    pool.deposit(authority.publicKey, {
      amountX: 5_000_000_000n,       // 5,000 X
      amountY: 750_000_000_000n,     // 750,000 Y  (= 5,000 base-equiv at mid $150)
      expiration: Math.floor(Date.now() / 1000) + 3600,
    }),
    [authority]
  );
  logTx("Deposit 5,000 X + 750,000 Y (50/50 value)", sig);

  // ---------------------------------------------------------------
  // 6. Update the midprice oracle
  //    The authority can push price updates at any time.
  // ---------------------------------------------------------------
  logHeader("Step 5 — Update midprice oracle");
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
  //    Other scripts use the most recent entry.
  //    Authority keypair is saved as a separate file.
  // ---------------------------------------------------------------
  logHeader("Step 6 — Save pool config to output/");
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
  logExplorer("View on Solscan:", pool.poolAddress.toBase58());
  logInfo("Next steps:", "npm run read         — inspect pool state");
  logInfo("", "             npm run write        — update midprice, curves, swap");
  logInfo("", "             npm run depth-curves — visualize depth curves");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
