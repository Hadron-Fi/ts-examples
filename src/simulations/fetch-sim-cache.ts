/**
 * Fetches pool + fee config from devnet and saves to output/sim-cache.json.
 * Run this before depth-curves on systems where litesvm + Connection conflict.
 *
 * Usage: npm run fetch-cache
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  Hadron,
  fromQ32,
  getFeeConfigAddress,
  decodeFeeConfig,
} from "@hadron-fi/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logHeader, logInfo } from "../setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const poolConfigPath = path.resolve(__dirname, "../../output/pool-config.json");
  if (!fs.existsSync(poolConfigPath)) {
    throw new Error("output/pool-config.json not found. Run 'npm run init' first.");
  }

  const raw = JSON.parse(fs.readFileSync(poolConfigPath, "utf-8"));
  const poolJson = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const poolAddress = new PublicKey(poolJson.poolAddress);

  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  logHeader("Fetching pool from devnet");
  logInfo("Pool:", poolAddress.toBase58());

  const pool = await Hadron.load(conn, poolAddress);
  const midprice = pool.getMidprice();
  const curves = pool.getActiveCurves();

  const config = {
    midprice,
    decimalsX: 6,
    decimalsY: 6,
    totalValueUsd: midprice * 10_000,
    priceCurves: {
      bid: {
        points: curves.priceBid.points.map((pt) => ({
          volume: Number(pt.amountIn) / 1e6,
          priceFactor: fromQ32(pt.priceFactorQ32),
        })),
      },
      ask: {
        points: curves.priceAsk.points.map((pt) => ({
          volume: Number(pt.amountIn) / 1e6,
          priceFactor: fromQ32(pt.priceFactorQ32),
        })),
      },
    },
    riskCurves: {
      bid: {
        points: curves.riskBid.points.map((pt) => ({
          pctBase: fromQ32(pt.amountIn),
          priceFactor: fromQ32(pt.priceFactorQ32),
        })),
      },
      ask: {
        points: curves.riskAsk.points.map((pt) => ({
          pctBase: fromQ32(pt.amountIn),
          priceFactor: fromQ32(pt.priceFactorQ32),
        })),
      },
    },
  };

  const [feeConfigPda] = getFeeConfigAddress();
  const feeConfigAcct = await conn.getAccountInfo(feeConfigPda);
  if (!feeConfigAcct) throw new Error("Fee config not found on devnet");
  const feeRecipient = decodeFeeConfig(feeConfigAcct.data).feeRecipient;

  const outputDir = path.resolve(__dirname, "../../output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const cachePath = path.join(outputDir, "sim-cache.json");
  fs.writeFileSync(cachePath, JSON.stringify({
    config,
    feeConfigPda: feeConfigPda.toBase58(),
    feeConfigLamports: feeConfigAcct.lamports,
    feeConfigData: Buffer.from(feeConfigAcct.data).toString("base64"),
    feeRecipient: feeRecipient.toBase58(),
  }));

  logInfo("Midprice:", midprice.toFixed(4));
  logInfo("Cached:", cachePath);
  logHeader("Done — now run: npm run depth-curves");

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
