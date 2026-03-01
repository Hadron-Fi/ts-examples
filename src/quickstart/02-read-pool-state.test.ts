/**
 * Example: Read pool state from devnet.
 *
 * Loads the pool created by test 01 (from output/pool-config.json)
 * and prints all key state: midprice, spread, active curves with
 * decoded points, vault balances, and oracle metadata.
 *
 * Prerequisites:
 *   Run test 01 first on devnet to create the pool:
 *     npm run init
 *
 * Run:
 *   npm run read
 */
import { describe, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  fromQ32,
  Interpolation,
  CurveXMode,
  type CurveSide,
} from "@hadron-fi/sdk";
import { TestHarness, logInfo, logHeader } from "../setup";
import fs from "fs";
import path from "path";

/** Map interpolation enum to readable name. */
function interpName(i: Interpolation): string {
  return Interpolation[i] ?? `Unknown(${i})`;
}

/** Format a curve side as a human-readable table. */
function formatCurve(label: string, curve: CurveSide, isRisk: boolean): void {
  const xLabel = isRisk ? "X (pct/abs)" : "X (amountIn)";
  logInfo(`  ${label}:`, `${curve.numPoints} points, interp=${interpName(curve.defaultInterpolation)}, xMode=${CurveXMode[curve.xMode] ?? curve.xMode}`);
  for (const pt of curve.points) {
    const x = isRisk
      ? fromQ32(pt.amountIn).toFixed(6)
      : pt.amountIn.toString();
    const factor = fromQ32(pt.priceFactorQ32).toFixed(8);
    logInfo(`    ${xLabel}=${x}`, `factor=${factor}  interp=${interpName(pt.interpolation)}`);
  }
}

describe("Read pool state", () => {
  it("loads and prints pool state from devnet", async () => {
    // ------------------------------------------------------------------
    // Load pool config from test 01 output
    // ------------------------------------------------------------------
    const configPath = path.resolve(__dirname, "../../output/pool-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        "output/pool-config.json not found. Run test 01 on devnet first:\n" +
          "  npm run init"
      );
    }

    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const poolJson = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const poolAddress = new PublicKey(poolJson.poolAddress);

    const h = new TestHarness();

    // ------------------------------------------------------------------
    // Load pool
    // ------------------------------------------------------------------
    logHeader("Loading pool");
    const pool = await h.loadPool(poolAddress);

    // ------------------------------------------------------------------
    // Basic info
    // ------------------------------------------------------------------
    logHeader("Pool Info");
    logInfo("Address:", poolAddress.toBase58());
    logInfo("Authority:", pool.config.authority.toBase58());
    logInfo("Mint X:", pool.config.mintX.toBase58());
    logInfo("Mint Y:", pool.config.mintY.toBase58());
    logInfo("Seed:", pool.config.seed.toString());

    // ------------------------------------------------------------------
    // Midprice & spread
    // ------------------------------------------------------------------
    logHeader("Oracle");
    const midprice = pool.getMidprice();
    const spread = pool.getBaseSpread();
    logInfo("Midprice:", midprice.toFixed(6));
    logInfo("Base Spread:", `${spread.toFixed(8)} (${(spread * 10000).toFixed(2)} bps)`);
    logInfo("Sequence:", pool.oracle.sequence.toString());
    logInfo("Last Update Slot:", pool.oracle.lastUpdateSlot.toString());

    // ------------------------------------------------------------------
    // Active curve slots
    // ------------------------------------------------------------------
    logHeader("Active Curve Slots");
    const slots = pool.getActiveCurveSlots();
    logInfo("Price Bid:", `slot ${slots.priceBid}`);
    logInfo("Price Ask:", `slot ${slots.priceAsk}`);
    logInfo("Risk Bid:", `slot ${slots.riskBid}`);
    logInfo("Risk Ask:", `slot ${slots.riskAsk}`);

    // ------------------------------------------------------------------
    // Decoded curves
    // ------------------------------------------------------------------
    logHeader("Active Curves");
    const curves = pool.getActiveCurves();
    formatCurve("Price Bid", curves.priceBid, false);
    formatCurve("Price Ask", curves.priceAsk, false);
    formatCurve("Risk Bid", curves.riskBid, true);
    formatCurve("Risk Ask", curves.riskAsk, true);

    // ------------------------------------------------------------------
    // Vault balances
    // ------------------------------------------------------------------
    logHeader("Vault Balances");
    const conn = h.getConnection();
    const [balX, balY] = await Promise.all([
      conn.getTokenAccountBalance(pool.addresses.vaultX),
      conn.getTokenAccountBalance(pool.addresses.vaultY),
    ]);
    logInfo("Vault X:", `${balX.value.uiAmountString} (${balX.value.amount} atoms)`);
    logInfo("Vault Y:", `${balY.value.uiAmountString} (${balY.value.amount} atoms)`);

    logHeader("Done!");
  }, 30_000);
});
