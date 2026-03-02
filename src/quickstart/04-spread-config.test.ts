/**
 * Example: Configure spread triggers and observe their effect on swaps.
 *
 * Loads the pool created by test 01 (from output/pool-config.json)
 * and demonstrates the spread config system using the pool helper methods:
 *
 *   1. Initialize a spread config on the pool
 *   2. Swap at base spread (baseline)
 *   3. Add spread triggers via pool.addSpreadTriggers() — additive merge
 *   4. Swap with wide triggers active
 *   5. Add a third trigger — demonstrates merge/upsert behavior
 *   6. Remove specific triggers via pool.removeSpreadTriggers()
 *   7. Swap with remaining trigger
 *   8. Full replacement via pool.updateSpreadConfig() — tighten spread
 *   9. Swap with tight trigger
 *  10. Clear all triggers
 *  11. Final swap at base spread
 *
 * Spread triggers let a market maker automatically widen the
 * bid/ask spread when specific on-chain accounts are present in
 * the swap instruction (e.g. high-frequency traders, known arb bots).
 * Each trigger adds its spreadBps on top of the pool's base spread.
 *
 * Prerequisites:
 *   Run test 01 first on devnet to create the pool:
 *     npm run init
 *
 * Run:
 *   npm run spread
 */
import { describe, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  decodeFeeConfig,
  decodeSpreadConfig,
  getFeeConfigAddress,
  getSpreadConfigAddress,
  type SpreadTriggerInput,
} from "@hadron-fi/sdk";
import { TestHarness, logTx, logInfo, logHeader } from "../setup";
import fs from "fs";
import path from "path";

/** Pretty-print spread triggers from on-chain state. */
function logTriggers(label: string, triggers: SpreadTriggerInput[]) {
  if (triggers.length === 0) {
    logInfo(label, "(none)");
  } else {
    for (const t of triggers) {
      logInfo(label, `${t.account.toBase58().slice(0, 8)}… → ${t.spreadBps} bps`);
    }
  }
}

describe("Spread config", () => {
  it("initializes spread config, sets triggers, and swaps at different spreads", async () => {
    // ------------------------------------------------------------------
    // Load pool config from test 01 output
    // ------------------------------------------------------------------
    // Accept a pool address via POOL env var, otherwise use the latest from pool-config.json
    // Usage: POOL=<address> npm run spread
    const configPath = path.resolve(__dirname, "../../output/pool-config.json");
    let poolJson: any;
    if (process.env.POOL) {
      if (!fs.existsSync(configPath)) {
        throw new Error("output/pool-config.json not found — need authority keypair for writes.");
      }
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const pools = Array.isArray(raw) ? raw : [raw];
      poolJson = pools.find((p: any) => p.poolAddress === process.env.POOL);
      if (!poolJson) {
        throw new Error(`Pool ${process.env.POOL} not found in pool-config.json`);
      }
    } else {
      if (!fs.existsSync(configPath)) {
        throw new Error(
          "output/pool-config.json not found. Run test 01 first:\n" +
            "  npm run init\n" +
            "Or pass a pool address directly:\n" +
            "  POOL=<address> npm run spread"
        );
      }
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      poolJson = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    }
    const poolAddress = new PublicKey(poolJson.poolAddress);

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

    // Ensure payer has enough SOL
    if (!h.isLocal) {
      const conn = h.getConnection();
      const balance = await conn.getBalance(h.payer.publicKey);
      if (balance < 100_000_000) {
        logInfo("Payer balance low:", `${(balance / 1e9).toFixed(4)} SOL — requesting airdrop`);
        const airdropSig = await conn.requestAirdrop(h.payer.publicKey, 2_000_000_000);
        await conn.confirmTransaction(airdropSig);
      }
    }

    logHeader("Load existing pool");
    logInfo("Pool:", poolAddress.toBase58());
    logInfo("Authority:", authority.publicKey.toBase58());

    let pool = await h.loadPool(poolAddress);
    const mintX = pool.config.mintX;
    const mintY = pool.config.mintY;

    // Resolve fee recipient for swaps
    const [feeConfigPda] = getFeeConfigAddress();
    const conn = h.getConnection();
    const feeConfigAcct = await conn.getAccountInfo(feeConfigPda);
    if (!feeConfigAcct) throw new Error("Fee config not found");
    const feeRecipient = decodeFeeConfig(feeConfigAcct.data).feeRecipient;

    // Ensure authority has token ATAs with funds
    logHeader("Setup: fund authority for swaps");
    const userAtaX = await h.createAta(authority.publicKey, mintX);
    const userAtaY = await h.createAta(authority.publicKey, mintY);
    await h.createAta(feeRecipient, mintX);
    await h.createAta(feeRecipient, mintY);
    await h.mintTo(mintX, userAtaX, 10_000_000_000n); // 10k X
    await h.mintTo(mintY, userAtaY, 10_000_000_000n); // 10k Y
    logInfo("Minted:", "10,000 X + 10,000 Y to authority");

    // Helper to read & log spread config from chain
    const [spreadConfigPda] = getSpreadConfigAddress(poolAddress);
    async function readSpreadConfig() {
      const acct = await conn.getAccountInfo(spreadConfigPda);
      if (!acct) return null;
      return decodeSpreadConfig(acct.data);
    }

    // ------------------------------------------------------------------
    // 1. Initialize spread config
    //    pool.initializeSpreadConfig() — designates a spread admin
    //    who can manage triggers. Could be the same key or a delegate.
    //    Skipped if already initialized (idempotent on devnet reruns).
    // ------------------------------------------------------------------
    logHeader("1. Initialize spread config");

    const spreadAdmin = authority; // same key for simplicity

    if (pool.config.spreadConfigInitialized) {
      logInfo("Spread config:", "already initialized — skipping");
    } else {
      let initSig = await h.sendIx(
        pool.initializeSpreadConfig(
          h.payer.publicKey,
          authority.publicKey,
          { admin: spreadAdmin.publicKey }
        ),
        [authority]
      );
      logTx("pool.initializeSpreadConfig()", initSig);

      // Reload pool so config.spreadConfigInitialized is true
      // (swap includes the spread config PDA when the flag is set)
      pool = await h.loadPool(poolAddress);
    }
    logInfo("Spread admin:", spreadAdmin.publicKey.toBase58());
    logInfo("Spread config PDA:", spreadConfigPda.toBase58());

    // Clear any leftover triggers from previous runs
    const existing = await readSpreadConfig();
    if (existing && existing.numTriggers > 0) {
      logInfo("Clearing:", `${existing.numTriggers} leftover triggers from previous run`);
      await h.sendIx(
        pool.updateSpreadConfig(spreadAdmin.publicKey, { triggers: [] }),
        [spreadAdmin]
      );
    }

    // ------------------------------------------------------------------
    // 2. Swap at base spread (no triggers yet)
    //    This is the baseline — just the pool's base spread applies.
    // ------------------------------------------------------------------
    logHeader("2. Swap at base spread (no triggers)");

    let sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: true,
        amountIn: 10_000_000n, // 10 X
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 10 X → Y (base spread only)", sig);

    // ------------------------------------------------------------------
    // 3. Add spread triggers via pool.addSpreadTriggers()
    //    This method fetches current triggers, merges the new ones,
    //    and returns an updateSpreadConfig ix. Additive — existing
    //    triggers are preserved.
    // ------------------------------------------------------------------
    logHeader("3. Add spread triggers (wide: 30 + 50 bps)");

    const triggerAccount1 = Keypair.generate().publicKey;
    const triggerAccount2 = Keypair.generate().publicKey;
    const triggerAccount3 = Keypair.generate().publicKey;

    sig = await h.sendIx(
      await pool.addSpreadTriggers(
        spreadAdmin.publicKey,
        [
          { account: triggerAccount1, spreadBps: 30 }, // +30 bps
          { account: triggerAccount2, spreadBps: 50 }, // +50 bps
        ]
      ),
      [spreadAdmin]
    );
    logTx("pool.addSpreadTriggers() — 2 triggers", sig);

    let state = await readSpreadConfig();
    logInfo("On-chain triggers:", `${state!.numTriggers}`);
    logTriggers("  trigger", state!.triggers);

    // ------------------------------------------------------------------
    // 4. Swap with triggers active
    //    The spread is now base + max(matching triggers).
    // ------------------------------------------------------------------
    logHeader("4. Swap with wide triggers active");

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: true,
        amountIn: 10_000_000n, // 10 X
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 10 X → Y (triggers: +30/+50 bps)", sig);

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: false,
        amountIn: 100_000_000n, // 100 Y
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 100 Y → X (triggers: +30/+50 bps)", sig);

    // ------------------------------------------------------------------
    // 5. Add a third trigger — demonstrates merge behavior
    //    pool.addSpreadTriggers() preserves the existing 2 and adds 1.
    //    Also upserts triggerAccount1: 30 bps → 40 bps.
    // ------------------------------------------------------------------
    logHeader("5. Add third trigger + upsert existing");

    sig = await h.sendIx(
      await pool.addSpreadTriggers(
        spreadAdmin.publicKey,
        [
          { account: triggerAccount3, spreadBps: 20 }, // new
          { account: triggerAccount1, spreadBps: 40 }, // upsert 30→40
        ]
      ),
      [spreadAdmin]
    );
    logTx("pool.addSpreadTriggers() — add 1, upsert 1", sig);

    state = await readSpreadConfig();
    logInfo("On-chain triggers:", `${state!.numTriggers}`);
    logTriggers("  trigger", state!.triggers);

    // ------------------------------------------------------------------
    // 6. Remove specific triggers via pool.removeSpreadTriggers()
    //    This method fetches current triggers, filters out the
    //    specified accounts, and returns an update ix.
    // ------------------------------------------------------------------
    logHeader("6. Remove 2 triggers (keep only trigger 1)");

    sig = await h.sendIx(
      await pool.removeSpreadTriggers(
        spreadAdmin.publicKey,
        [triggerAccount2, triggerAccount3]
      ),
      [spreadAdmin]
    );
    logTx("pool.removeSpreadTriggers() — removed 2", sig);

    state = await readSpreadConfig();
    logInfo("On-chain triggers:", `${state!.numTriggers}`);
    logTriggers("  trigger", state!.triggers);

    // ------------------------------------------------------------------
    // 7. Swap with remaining trigger
    // ------------------------------------------------------------------
    logHeader("7. Swap with single remaining trigger");

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: true,
        amountIn: 50_000_000n, // 50 X
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 50 X → Y (trigger: +40 bps)", sig);

    // ------------------------------------------------------------------
    // 8. Full replacement via pool.updateSpreadConfig()
    //    Replaces all triggers with a single tighter value.
    // ------------------------------------------------------------------
    logHeader("8. Full replacement — tighten to 5 bps");

    sig = await h.sendIx(
      pool.updateSpreadConfig(
        spreadAdmin.publicKey,
        { triggers: [{ account: triggerAccount1, spreadBps: 5 }] }
      ),
      [spreadAdmin]
    );
    logTx("pool.updateSpreadConfig() — replace all → 1 at 5 bps", sig);

    state = await readSpreadConfig();
    logInfo("On-chain triggers:", `${state!.numTriggers}`);
    logTriggers("  trigger", state!.triggers);

    // ------------------------------------------------------------------
    // 9. Swap with tight trigger
    // ------------------------------------------------------------------
    logHeader("9. Swap with tight trigger");

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: true,
        amountIn: 50_000_000n, // 50 X
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 50 X → Y (trigger: +5 bps)", sig);

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: false,
        amountIn: 500_000_000n, // 500 Y
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 500 Y → X (trigger: +5 bps)", sig);

    // ------------------------------------------------------------------
    // 10. Clear all triggers — back to base spread
    //     pool.updateSpreadConfig() with empty array removes everything.
    // ------------------------------------------------------------------
    logHeader("10. Clear all triggers");

    sig = await h.sendIx(
      pool.updateSpreadConfig(
        spreadAdmin.publicKey,
        { triggers: [] }
      ),
      [spreadAdmin]
    );
    logTx("pool.updateSpreadConfig() — clear all", sig);

    state = await readSpreadConfig();
    logInfo("On-chain triggers:", `${state!.numTriggers}`);
    logTriggers("  trigger", state!.triggers);

    // ------------------------------------------------------------------
    // 11. Final swap at base spread
    // ------------------------------------------------------------------
    logHeader("11. Swap at base spread (triggers cleared)");

    sig = await h.sendIx(
      pool.swap(authority.publicKey, {
        isX: true,
        amountIn: 10_000_000n, // 10 X
        minOut: 0n,
        feeRecipient,
      }),
      [authority]
    );
    logTx("Swap 10 X → Y (base spread only)", sig);

    logHeader("Done! Spread config lifecycle complete.");
  }, 120_000);
});
