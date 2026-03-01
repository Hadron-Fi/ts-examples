/**
 * Example: Write pool updates and execute swaps.
 *
 * Loads the pool created by test 01 (from output/pool-config.json)
 * and demonstrates the SDK methods that market makers use to update
 * pool parameters in real time:
 *
 *   1. updateMidprice — push a new midprice to the oracle
 *   2. updateBaseSpread — widen/narrow the base spread
 *   3. updateMidpriceAndBaseSpread — atomic update of both
 *   4. submitCurveUpdates — queue point edits to the price curve
 *   5. Swap — pending curve updates are applied during the swap
 *
 * Prerequisites:
 *   Run test 01 first on devnet to create the pool:
 *     npm run init
 *
 * Run:
 *   npm run write
 */
import { describe, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Hadron,
  toQ32,
  fromQ32,
  spreadBpsToQ32,
  Interpolation,
  CurveType,
  CurveUpdateOpKind,
  type CurveUpdateOp,
  decodeFeeConfig,
  getFeeConfigAddress,
} from "@hadron-fi/sdk";
import { TestHarness, logTx, logInfo, logHeader } from "../setup";
import fs from "fs";
import path from "path";

describe("Write pool updates", () => {
  it("updates midprice, spread, and curve points then swaps", async () => {
    // ------------------------------------------------------------------
    // Load pool config from test 01 output
    // ------------------------------------------------------------------
    const configPath = path.resolve(__dirname, "../../output/pool-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        "output/pool-config.json not found. Run test 01 on devnet first:\n" +
          "  NETWORK=devnet WALLET=./wallet.json npx vitest run src/01-*"
      );
    }

    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // Use most recent entry (array format) or single-object (legacy)
    const poolJson = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const poolAddress = new PublicKey(poolJson.poolAddress);

    // Load authority keypair from separate file (new) or inline (legacy)
    const outputDir = path.resolve(__dirname, "../../output");
    let authority: Keypair;
    if (poolJson.authorityKeyFile) {
      const keyBytes = JSON.parse(
        fs.readFileSync(path.join(outputDir, poolJson.authorityKeyFile), "utf-8")
      );
      authority = Keypair.fromSecretKey(Uint8Array.from(keyBytes));
    } else {
      authority = Keypair.fromSecretKey(Uint8Array.from(poolJson.authority));
    }

    const h = new TestHarness();

    // Ensure payer has enough SOL for ATA creation rent
    const conn = h.getConnection();
    const balance = await conn.getBalance(h.payer.publicKey);
    if (balance < 100_000_000) { // < 0.1 SOL
      logInfo("Payer balance low:", `${(balance / 1e9).toFixed(4)} SOL — requesting airdrop`);
      const airdropSig = await conn.requestAirdrop(h.payer.publicKey, 2_000_000_000);
      await conn.confirmTransaction(airdropSig);
    }

    logHeader("Load existing pool");
    logInfo("Pool:", poolAddress.toBase58());
    logInfo("Authority:", authority.publicKey.toBase58());

    const pool = await h.loadPool(poolAddress);
    const mintX = pool.config.mintX;
    const mintY = pool.config.mintY;

    // Resolve fee recipient for swaps
    const [feeConfigPda] = getFeeConfigAddress();
    const feeConfigAcct = await conn.getAccountInfo(feeConfigPda);
    if (!feeConfigAcct) throw new Error("Fee config not found");
    const feeRecipient = decodeFeeConfig(feeConfigAcct.data).feeRecipient;

    // Ensure authority has token ATAs with funds for swapping
    logHeader("Setup: fund authority for swaps");
    const userAtaX = await h.createAta(authority.publicKey, mintX);
    const userAtaY = await h.createAta(authority.publicKey, mintY);
    await h.createAta(feeRecipient, mintX);
    await h.createAta(feeRecipient, mintY);
    await h.mintTo(mintX, userAtaX, 10_000_000_000n); // 10k X
    await h.mintTo(mintY, userAtaY, 10_000_000_000n); // 10k Y
    logInfo("Minted:", "10,000 X + 10,000 Y to authority");

    // ------------------------------------------------------------------
    // 1. updateMidprice — move the midprice from 150 to 155
    // ------------------------------------------------------------------
    logHeader("updateMidprice");
    let sig = await h.sendIx(
      pool.updateMidprice(authority.publicKey, {
        midpriceQ32: toQ32(155.0),
      }),
      [authority]
    );
    logTx("Midprice 150 → 155", sig);

    // ------------------------------------------------------------------
    // 2. updateBaseSpread — set a 10 bps base spread
    //    spreadFactorQ32 is a discount factor: 1.0 = no spread.
    //    10 bps → spreadBpsToQ32(10) = toQ32(0.999)
    // ------------------------------------------------------------------
    logHeader("updateBaseSpread");
    sig = await h.sendIx(
      pool.updateBaseSpread(authority.publicKey, {
        spreadFactorQ32: spreadBpsToQ32(10),
      }),
      [authority]
    );
    logTx("Base spread → 10 bps", sig);

    // ------------------------------------------------------------------
    // 3. updateMidpriceAndBaseSpread — atomic update of both
    //    Move midprice to 158 and tighten spread to 5 bps
    // ------------------------------------------------------------------
    logHeader("updateMidpriceAndBaseSpread");
    sig = await h.sendIx(
      pool.updateMidpriceAndBaseSpread(authority.publicKey, {
        midpriceQ32: toQ32(158.0),
        spreadFactorQ32: spreadBpsToQ32(5),
      }),
      [authority]
    );
    logTx("Midprice → 158, spread → 5 bps", sig);

    // ------------------------------------------------------------------
    // 4. submitCurveUpdates — queue edits to price curve points
    //    These are staged but NOT yet applied to the active curve.
    //    They will be applied when the next swap executes.
    //
    //    Here we edit 3 bid price curve points to tighten
    //    the spread at depth. We read the current curve to get
    //    the exact amountIn values, then only change priceFactors.
    // ------------------------------------------------------------------
    logHeader("submitCurveUpdates");

    const curves = pool.getActiveCurves();
    const bidPts = curves.priceBid.points;
    logInfo("Current bid curve:", `${bidPts.length} points`);
    for (let i = 0; i < Math.min(3, bidPts.length); i++) {
      logInfo(`  [${i}]`, `amountIn=${bidPts[i].amountIn} factor=${fromQ32(bidPts[i].priceFactorQ32).toFixed(6)}`);
    }

    const ops: CurveUpdateOp[] = [
      // Edit point 0 — shift origin factor to 1.001
      {
        curveType: CurveType.PriceBid,
        opKind: CurveUpdateOpKind.Edit,
        pointIndex: 0,
        interpolation: Interpolation.Linear,
        amountIn: bidPts[0].amountIn,
        priceFactorQ32: toQ32(1.001),
        params: new Uint8Array(4),
      },
      // Edit point 1 — tighten factor to 0.9995
      {
        curveType: CurveType.PriceBid,
        opKind: CurveUpdateOpKind.Edit,
        pointIndex: 1,
        interpolation: Interpolation.Linear,
        amountIn: bidPts[1].amountIn,
        priceFactorQ32: toQ32(0.9995),
        params: new Uint8Array(4),
      },
      // Edit point 2 — tighten factor to 0.999
      {
        curveType: CurveType.PriceBid,
        opKind: CurveUpdateOpKind.Edit,
        pointIndex: 2,
        interpolation: Interpolation.Linear,
        amountIn: bidPts[2].amountIn,
        priceFactorQ32: toQ32(0.999),
        params: new Uint8Array(4),
      },
    ];

    sig = await h.sendIx(
      pool.submitCurveUpdates(authority.publicKey, ops),
      [authority]
    );
    logTx(`Submit ${ops.length} curve update ops (edit x${ops.length})`, sig);
    logInfo("Note:", "Updates are queued — they apply on the next swap.");

    // ------------------------------------------------------------------
    // 5. Swap — pending curve updates are applied during execution
    // ------------------------------------------------------------------
    logHeader("Swap: sell 10 X (bid side, applies pending updates)");

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: true, // selling X for Y (bid side)
        amountIn: 10_000_000n, // 10 X tokens
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 10 X → Y", sig);

    // ------------------------------------------------------------------
    // 6. Swap the other direction — buy X with Y (ask side)
    // ------------------------------------------------------------------
    logHeader("Swap: sell 100 Y (ask side)");

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: false, // selling Y for X (ask side)
        amountIn: 100_000_000n, // 100 Y tokens
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 100 Y → X", sig);

    logHeader("Done! All update methods exercised.");
  }, 120_000);
});
