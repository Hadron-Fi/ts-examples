/**
 * Simulation: Compare interpolation modes on the same pool.
 *
 * Uses LiteSVM to create a fresh pool per probe per interpolation mode
 * at 50/50 value inventory, runs bid-side probe swaps, then generates
 * an HTML visualization with all 5 modes overlaid.
 *
 * Modes compared:
 *   Step         — flat steps, jumps at each control point
 *   Linear       — straight lines between points
 *   Hyperbolic   — concave (k=0.3), reaches target faster
 *   Quadratic    — convex (k=0.7), stays near origin longer
 *   Cubic        — S-curve (a=0.5, b=-0.25)
 *
 * Run:
 *   npm run interp
 *
 * Output:
 *   output/interp-comparison.html
 */
import { LiteSVM, FeatureSet } from "litesvm";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MintLayout,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Hadron,
  toQ32,
  Interpolation,
  Side,
  decodeConfig,
  decodeMidpriceOracle,
  decodeCurveMeta,
  derivePoolAddresses,
  HADRON_PROGRAM_ID,
} from "@hadron-fi/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logHeader, logInfo, PROGRAM_ID } from "../setup";

// ============================================================================
// LiteSVM helpers
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROGRAM_PATH = path.resolve(__dirname, "../../programs/hadron.so");

function humanToAtoms(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

function atomsToHuman(atoms: bigint, decimals: number): number {
  return Number(atoms) / 10 ** decimals;
}

function getTokenBalance(svm: LiteSVM, ata: PublicKey): bigint {
  const account = svm.getAccount(ata);
  if (!account) return 0n;
  const data = Buffer.from(account.data);
  return data.readBigUInt64LE(64);
}

function sendTx(
  svm: LiteSVM,
  payer: Keypair,
  ixs: TransactionInstruction[],
  signers?: Keypair[]
): void {
  const tx = new Transaction();
  for (const ix of ixs) tx.add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer, ...(signers ?? []));
  const result = svm.sendTransaction(tx);
  if (typeof (result as any).err === "function") {
    const logs =
      typeof (result as any).meta === "function"
        ? (result as any).meta().logs()
        : [];
    throw new Error(
      `Transaction failed: ${(result as any).toString()}\nLogs: ${logs.join("\n")}`
    );
  }
  svm.expireBlockhash();
}

function createMintInSvm(
  svm: LiteSVM,
  payer: Keypair,
  mintKp: Keypair,
  decimals: number
): void {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: payer.publicKey,
      supply: 0n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data
  );
  svm.setAccount(mintKp.publicKey, {
    lamports: 1_000_000_000n,
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}

/** Inject a token account directly via setAccount — avoids SPL Token BPF execution. */
function injectTokenAccount(
  svm: LiteSVM,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint = 0n
): PublicKey {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  if (svm.getAccount(ata)) return ata;
  // SPL Token account layout: 165 bytes
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);         // mint (32)
  owner.toBuffer().copy(data, 32);       // owner (32)
  data.writeBigUInt64LE(amount, 64);     // amount (8)
  data.writeUInt8(1, 108);               // state = Initialized
  svm.setAccount(ata, {
    lamports: 1_000_000_000n,
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
  return ata;
}

function loadPoolFromSvm(svm: LiteSVM, poolAddress: PublicKey): Hadron {
  const configData = svm.getAccount(poolAddress);
  if (!configData)
    throw new Error(`Pool not found: ${poolAddress.toBase58()}`);
  const config = decodeConfig(new Uint8Array(configData.data));
  const addrs = derivePoolAddresses(
    config.seed,
    config.mintX,
    config.mintY,
    config.tokenProgramX,
    config.tokenProgramY,
    HADRON_PROGRAM_ID
  );
  const oracleData = svm.getAccount(addrs.midpriceOracle);
  if (!oracleData) throw new Error("Oracle not found");
  const curveMetaData = svm.getAccount(addrs.curveMeta);
  if (!curveMetaData) throw new Error("CurveMeta not found");
  const curvePrefabsData = svm.getAccount(addrs.curvePrefabs);
  if (!curvePrefabsData) throw new Error("CurvePrefabs not found");
  return new Hadron(
    null as any,
    poolAddress,
    addrs,
    config,
    decodeMidpriceOracle(new Uint8Array(oracleData.data)),
    decodeCurveMeta(new Uint8Array(curveMetaData.data)),
    new Uint8Array(curvePrefabsData.data),
    HADRON_PROGRAM_ID
  );
}

// ============================================================================
// Interpolation mode definitions
// ============================================================================

interface InterpMode {
  name: string;
  interpolation: Interpolation;
  params: Uint8Array;
  color: string;
}

function q16(value: number): Uint8Array {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(Math.floor(value * 65536));
  return new Uint8Array(buf);
}

function q8Pair(a: number, b: number): Uint8Array {
  const buf = Buffer.alloc(4);
  buf.writeInt16LE(Math.round(a * 256), 0);
  buf.writeInt16LE(Math.round(b * 256), 2);
  return new Uint8Array(buf);
}

const MODES: InterpMode[] = [
  { name: "Step",       interpolation: Interpolation.Step,       params: new Uint8Array(4), color: "#f97316" },
  { name: "Linear",     interpolation: Interpolation.Linear,     params: new Uint8Array(4), color: "#22c55e" },
  { name: "Hyperbolic", interpolation: Interpolation.Hyperbolic, params: q16(0.3),          color: "#60a5fa" },
  { name: "Quadratic",  interpolation: Interpolation.Quadratic,  params: q16(0.7),          color: "#a78bfa" },
  { name: "Cubic",      interpolation: Interpolation.Cubic,      params: q8Pair(0.5, -0.25), color: "#f472b6" },
];

// ============================================================================
// Config
// ============================================================================

const MIDPRICE = 150.0;
const DECIMALS_X = 6;
const DECIMALS_Y = 6;

// 50/50 value split: $1.5M each side → 10k X + 1.5M Y
const TOTAL_VALUE_USD = 3_000_000;
const DEPOSIT_X = TOTAL_VALUE_USD / 2 / MIDPRICE; // 10,000 X tokens
const DEPOSIT_Y = TOTAL_VALUE_USD / 2;             // 1,500,000 Y tokens

const BID_POINTS = [
  { volume: 0,    priceFactor: 1.0 },
  { volume: 500,  priceFactor: 0.995 },
  { volume: 1000, priceFactor: 0.98 },
];

const ASK_POINTS = [
  { volume: 0,      priceFactor: 1.0 },
  { volume: 75000,  priceFactor: 0.995 },
  { volume: 150000, priceFactor: 0.98 },
];

const RISK_POINTS_BID = [
  { pctBase: 0.0,  priceFactor: 0.9 },
  { pctBase: 0.25, priceFactor: 0.97 },
  { pctBase: 0.5,  priceFactor: 1.0 },
  { pctBase: 1.0,  priceFactor: 1.0 },
];

const RISK_POINTS_ASK = [
  { pctBase: 0.0,  priceFactor: 1.0 },
  { pctBase: 0.5,  priceFactor: 1.0 },
  { pctBase: 0.75, priceFactor: 0.97 },
  { pctBase: 1.0,  priceFactor: 0.9 },
];

const PROBE_POINTS = 50;
const BID_MAX_VOLUME = 1100; // past last control point (1000) to show tail behavior

// ============================================================================
// Per-mode data collection (bid only)
// ============================================================================

interface DepthPoint {
  price: number;
  cumVolume: number;
}

interface ModeResult {
  name: string;
  color: string;
  bid: DepthPoint[];
}

// ============================================================================
// SVM factory — creates a fresh instance per mode to avoid memory accumulation
// ============================================================================

interface SvmEnv {
  svm: LiteSVM;
  payer: Keypair;
  mintX: PublicKey;
  mintY: PublicKey;
  payerAtaX: PublicKey;
  payerAtaY: PublicKey;
  feeRecipient: PublicKey;
}

function createSvmEnv(
  feeConfigPda: PublicKey,
  feeConfigLamports: number,
  feeConfigData: Buffer,
  feeRecipient: PublicKey,
): SvmEnv {
  const svm = LiteSVM.default()
    .withFeatureSet(FeatureSet.allEnabled())
    .withSigverify(false)
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms()
    .withLamports(1_000_000_000_000_000n);

  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_PATH);

  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, 100_000_000_000_000n);

  const mintX = Keypair.generate();
  const mintY = Keypair.generate();
  createMintInSvm(svm, payer, mintX, DECIMALS_X);
  createMintInSvm(svm, payer, mintY, DECIMALS_Y);

  svm.setAccount(feeConfigPda, {
    lamports: BigInt(feeConfigLamports),
    data: Buffer.from(feeConfigData),
    owner: HADRON_PROGRAM_ID,
    executable: false,
  });
  svm.airdrop(feeRecipient, 1_000_000_000n);

  // Inject token accounts directly — bypasses SPL Token/ATA BPF execution
  // which crashes on some x86 litesvm builds (std::bad_alloc in BPF JIT)
  const largeBalance = 1_000_000_000_000_000n;
  injectTokenAccount(svm, mintX.publicKey, feeRecipient, 0n);
  injectTokenAccount(svm, mintY.publicKey, feeRecipient, 0n);
  const payerAtaX = injectTokenAccount(svm, mintX.publicKey, payer.publicKey, largeBalance);
  const payerAtaY = injectTokenAccount(svm, mintY.publicKey, payer.publicKey, largeBalance);

  return { svm, payer, mintX: mintX.publicKey, mintY: mintY.publicKey, payerAtaX, payerAtaY, feeRecipient };
}

// ============================================================================
// Per-mode data collection — fresh SVM per mode to keep memory bounded
// ============================================================================

let seedCounter = 0n;

function collectModeBidDepth(
  feeConfigPda: PublicKey,
  feeConfigLamports: number,
  feeConfigData: Buffer,
  feeRecipient: PublicKey,
  mode: InterpMode
): ModeResult {
  const env = createSvmEnv(feeConfigPda, feeConfigLamports, feeConfigData, feeRecipient);
  const bid: DepthPoint[] = [];

  for (let p = 1; p <= PROBE_POINTS; p++) {
    const volume = (BID_MAX_VOLUME * p) / PROBE_POINTS;

    try {
      seedCounter++;
      const { instructions, poolAddress } = Hadron.initialize(env.payer.publicKey, {
        seed: seedCounter,
        mintX: env.mintX,
        mintY: env.mintY,
        authority: env.payer.publicKey,
        initialMidpriceQ32: toQ32(MIDPRICE),
      });
      sendTx(env.svm, env.payer, instructions);

      const pool = loadPoolFromSvm(env.svm, poolAddress);

      // Set price curves
      sendTx(env.svm, env.payer, [
        pool.setCurve(env.payer.publicKey, {
          side: Side.Bid,
          defaultInterpolation: mode.interpolation,
          slot: 0,
          points: BID_POINTS.map((pt) => ({
            amountIn: humanToAtoms(pt.volume, DECIMALS_X),
            priceFactor: pt.priceFactor,
            params: mode.params,
          })),
        }),
        pool.setCurve(env.payer.publicKey, {
          side: Side.Ask,
          defaultInterpolation: Interpolation.Linear,
          slot: 0,
          points: ASK_POINTS.map((pt) => ({
            amountIn: humanToAtoms(pt.volume, DECIMALS_Y),
            priceFactor: pt.priceFactor,
          })),
        }),
      ]);

      // Set risk curves (Linear for all)
      sendTx(env.svm, env.payer, [
        pool.setRiskCurve(env.payer.publicKey, {
          side: Side.Bid,
          defaultInterpolation: Interpolation.Linear,
          slot: 0,
          points: RISK_POINTS_BID,
        }),
        pool.setRiskCurve(env.payer.publicKey, {
          side: Side.Ask,
          defaultInterpolation: Interpolation.Linear,
          slot: 0,
          points: RISK_POINTS_ASK,
        }),
      ]);

      // Deposit — inject vault ATAs directly (bypasses SPL Token BPF)
      injectTokenAccount(env.svm, env.mintX, pool.addresses.config, 0n);
      injectTokenAccount(env.svm, env.mintY, pool.addresses.config, 0n);
      sendTx(env.svm, env.payer, [
        pool.deposit(env.payer.publicKey, {
          amountX: humanToAtoms(DEPOSIT_X, DECIMALS_X),
          amountY: humanToAtoms(DEPOSIT_Y, DECIMALS_Y),
        }),
      ]);

      // Bid probe: sell X → Y
      const amountIn = humanToAtoms(volume, DECIMALS_X);
      const beforeY = getTokenBalance(env.svm, env.payerAtaY);
      sendTx(env.svm, env.payer, [
        pool.swap(env.payer.publicKey, {
          isX: true,
          amountIn,
          minOut: 0n,
          feeRecipient: env.feeRecipient,
        }),
      ]);
      const afterY = getTokenBalance(env.svm, env.payerAtaY);
      const outH = atomsToHuman(afterY - beforeY, DECIMALS_Y);
      if (outH > 0) bid.push({ price: outH / volume, cumVolume: volume });
    } catch { /* skip failed probes */ }
  }

  return { name: mode.name, color: mode.color, bid };
}

// ============================================================================
// HTML generation
// ============================================================================

function generateInterpHtml(
  modeResults: ModeResult[],
  outputPath: string
): void {
  const midprice = MIDPRICE;

  const allPrices = modeResults.flatMap((m) => m.bid.map((p) => p.price));
  const allVols = modeResults.flatMap((m) => m.bid.map((p) => p.cumVolume));

  const priceMin = allPrices.length ? Math.min(...allPrices) * 0.9993 : midprice * 0.97;
  const priceMax = midprice * 1.001;
  const maxVol = allVols.length ? Math.max(...allVols) * 1.05 : 100;

  const traces = JSON.stringify(modeResults.map((m) => ({
    x: m.bid.map((p) => p.price),
    y: m.bid.map((p) => p.cumVolume),
    mode: "lines+markers",
    name: m.name,
    line: { color: m.color, width: 2.5 },
    marker: { color: m.color, size: 4 },
  })));

  // Control point volumes for vertical reference lines
  const cpVolumes = BID_POINTS.filter((p) => p.volume > 0).map((p) => p.volume);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Hadron Interpolation Comparison</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\/script>
  <style>
    body {
      margin: 0; padding: 24px 32px;
      background: #111827; color: #f3f4f6;
      font-family: "Inter", system-ui, sans-serif;
    }
    h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 4px; }
    .subtitle { color: #9ca3af; font-size: 0.85em; margin-bottom: 16px; }
    #chart { width: 100%; height: 80vh; }
  </style>
</head>
<body>
  <h1>Interpolation Comparison — Bid Depth Curves</h1>
  <p class="subtitle">
    50/50 value inventory &middot; Midprice $${midprice} &middot;
    Control points: 0 X &rarr; 1.0, 500 X &rarr; 0.995, 1000 X &rarr; 0.98
  </p>
  <div id="chart"></div>
  <script>
    const traces = ${traces};
    const layout = {
      paper_bgcolor: '#111827',
      plot_bgcolor: '#111827',
      font: { color: '#f3f4f6', family: '"Inter", system-ui, sans-serif', size: 12 },
      xaxis: {
        title: { text: 'Effective Price (Y per X)', font: { size: 13 } },
        tickprefix: '$',
        range: [${priceMin}, ${priceMax}],
        gridcolor: 'rgba(148,163,184,0.12)',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'Trade Size (X tokens)', font: { size: 13 } },
        range: [0, ${maxVol}],
        gridcolor: 'rgba(148,163,184,0.12)',
        zeroline: false,
      },
      shapes: [
        // Midprice vertical
        {
          type: 'line', x0: ${midprice}, x1: ${midprice},
          y0: 0, y1: ${maxVol},
          line: { color: '#4b5563', dash: 'dot', width: 1 },
        },
        // Control point horizontal lines
        ${cpVolumes.map((v) => `{
          type: 'line', x0: ${priceMin}, x1: ${priceMax},
          y0: ${v}, y1: ${v},
          line: { color: 'rgba(148,163,184,0.18)', dash: 'dot', width: 1 },
        }`).join(",\n        ")},
      ],
      annotations: [
        {
          x: ${midprice}, y: ${maxVol * 0.98},
          text: 'Mid $${midprice}', showarrow: false,
          font: { color: '#6b7280', size: 11 }, xanchor: 'left', xshift: 6,
        },
        ${cpVolumes.map((v, i) => `{
          x: ${priceMax}, y: ${v},
          text: '${v} X  (f=${BID_POINTS[i + 1].priceFactor})',
          showarrow: false,
          font: { color: '#6b7280', size: 10 },
          xanchor: 'right', yshift: -10,
        }`).join(",\n        ")},
      ],
      legend: {
        x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top',
        font: { size: 13 },
        bgcolor: 'rgba(17,24,39,0.8)',
        bordercolor: 'rgba(148,163,184,0.2)',
        borderwidth: 1,
      },
      margin: { l: 70, r: 40, t: 30, b: 60 },
      hovermode: 'x unified',
    };
    Plotly.newPlot('chart', traces, layout, {
      responsive: true,
      displayModeBar: false,
    });
  <\/script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, { encoding: "utf8" });
}

// ============================================================================
// Main
// ============================================================================

(async () => {
  // ------------------------------------------------------------------
  // Load fee config from cache (auto-fetch via subprocess if missing)
  // ------------------------------------------------------------------
  const cachePath = path.resolve(__dirname, "../../output/sim-cache.json");

  if (!fs.existsSync(cachePath)) {
    logHeader("Fetching pool data from devnet");
    const fetchScript = path.resolve(__dirname, "fetch-sim-cache.ts");
    const { execFileSync } = await import("child_process");
    execFileSync("npx", ["tsx", fetchScript], {
      stdio: "inherit",
      env: process.env,
    });
  }

  if (!fs.existsSync(cachePath)) {
    throw new Error("Failed to create sim-cache.json. Check devnet connection.");
  }

  const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  const feeConfigPda = new PublicKey(cache.feeConfigPda);
  const feeConfigData = Buffer.from(cache.feeConfigData, "base64");
  const feeRecipient = new PublicKey(cache.feeRecipient);

  // -----------------------------------------------------------------
  // Collect bid depth data for each mode (fresh SVM per mode)
  // -----------------------------------------------------------------
  const modeResults: ModeResult[] = [];

  for (const mode of MODES) {
    logHeader(`Probing: ${mode.name}`);
    const result = collectModeBidDepth(
      feeConfigPda, cache.feeConfigLamports, feeConfigData,
      feeRecipient, mode
    );
    logInfo("Bid points:", String(result.bid.length));
    modeResults.push(result);
  }

  // -----------------------------------------------------------------
  // Generate HTML
  // -----------------------------------------------------------------
  const outputDir = path.resolve(__dirname, "../../output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, "interp-comparison.html");
  generateInterpHtml(modeResults, htmlPath);

  logHeader("Done!");
  logInfo("Visualization:", htmlPath);

  // -----------------------------------------------------------------
  // Print comparison table
  // -----------------------------------------------------------------
  logHeader("Summary table");

  const sampleVolumes = [22, 100, 250, 500, 750, 1000, 1100];
  const colW = 14;
  const volW = 14;
  const modeNames = MODES.map((m) => m.name);
  const sep = "─".repeat(volW) + "┼" + modeNames.map(() => "─".repeat(colW)).join("┼");

  console.log("\nEffective Bid Price (Y/X) at select volumes");
  console.log(sep);
  console.log(
    "Volume (X)".padEnd(volW) + "│" +
    modeNames.map((n) => n.padStart(colW)).join("│")
  );
  console.log(sep);

  for (const targetVol of sampleVolumes) {
    const cells = modeResults.map((m) => {
      const closest = m.bid.reduce<DepthPoint | null>((best, pt) => {
        if (!best) return pt;
        return Math.abs(pt.cumVolume - targetVol) < Math.abs(best.cumVolume - targetVol) ? pt : best;
      }, null);
      return closest
        ? closest.price.toFixed(3).padStart(colW)
        : "—".padStart(colW);
    });
    console.log(String(targetVol).padEnd(volW) + "│" + cells.join("│"));
  }

  console.log(sep);
  console.log("");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
