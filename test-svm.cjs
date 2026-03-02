const { LiteSVM, FeatureSet } = require("litesvm");
const { PublicKey, Keypair, Transaction, Connection } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, MintLayout, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createMintToInstruction } = require("@solana/spl-token");
const { Hadron, toQ32, Interpolation, Side, HADRON_PROGRAM_ID, getFeeConfigAddress, decodeFeeConfig, decodeConfig, decodeMidpriceOracle, decodeCurveMeta, derivePoolAddresses } = require("@hadron-fi/sdk");
const path = require("path");

const PROGRAM_PATH = path.resolve(__dirname, "programs/hadron.so");

function logMem(label) {
  const used = process.memoryUsage();
  console.log(`  [${label}] rss=${Math.round(used.rss / 1024 / 1024)}MB`);
}

function sendTx(svm, payer, ixs) {
  const tx = new Transaction();
  for (const ix of ixs) tx.add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer);
  svm.sendTransaction(tx);
  svm.expireBlockhash();
}

function createMint(svm, payer, mintKp, decimals) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({
    mintAuthorityOption: 1, mintAuthority: payer.publicKey, supply: 0n, decimals,
    isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default,
  }, data);
  svm.setAccount(mintKp.publicKey, { lamports: 1000000000n, data, owner: TOKEN_PROGRAM_ID, executable: false });
}

function createAta(svm, payer, owner, mint) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  if (svm.getAccount(ata)) return ata;
  sendTx(svm, payer, [createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint)]);
  return ata;
}

function loadPool(svm, addr) {
  const d = svm.getAccount(addr);
  const c = decodeConfig(new Uint8Array(d.data));
  const a = derivePoolAddresses(c.seed, c.mintX, c.mintY, c.tokenProgramX, c.tokenProgramY, HADRON_PROGRAM_ID);
  return new Hadron(null, addr, a, c,
    decodeMidpriceOracle(new Uint8Array(svm.getAccount(a.midpriceOracle).data)),
    decodeCurveMeta(new Uint8Array(svm.getAccount(a.curveMeta).data)),
    new Uint8Array(svm.getAccount(a.curvePrefabs).data), HADRON_PROGRAM_ID);
}

async function main() {
  console.log("A. Fetch fee config from devnet");
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");
  const [feeConfigPda] = getFeeConfigAddress();
  const feeConfigAcct = await conn.getAccountInfo(feeConfigPda);
  if (!feeConfigAcct) throw new Error("Fee config not found");
  const feeRecipient = decodeFeeConfig(feeConfigAcct.data).feeRecipient;
  logMem("devnet fetch done");

  console.log("B. Create SVM");
  const svm = LiteSVM.default()
    .withFeatureSet(FeatureSet.allEnabled())
    .withSigverify(false)
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms()
    .withLamports(1000000000000000n);
  svm.addProgramFromFile(HADRON_PROGRAM_ID, PROGRAM_PATH);
  logMem("svm created");

  console.log("C. Inject fee config into SVM");
  svm.setAccount(feeConfigPda, {
    lamports: BigInt(feeConfigAcct.lamports),
    data: Buffer.from(feeConfigAcct.data),
    owner: HADRON_PROGRAM_ID,
    executable: false,
  });
  logMem("fee config injected");

  console.log("D. Setup payer + mints");
  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, 100000000000000n);
  svm.airdrop(feeRecipient, 1000000000n);
  const mintX = Keypair.generate();
  const mintY = Keypair.generate();
  createMint(svm, payer, mintX, 6);
  createMint(svm, payer, mintY, 6);
  logMem("mints created");

  console.log("E. Create ATAs");
  createAta(svm, payer, feeRecipient, mintX.publicKey);
  createAta(svm, payer, feeRecipient, mintY.publicKey);
  const payerAtaX = createAta(svm, payer, payer.publicKey, mintX.publicKey);
  const payerAtaY = createAta(svm, payer, payer.publicKey, mintY.publicKey);
  logMem("atas created");

  console.log("F1. Mint X tokens");
  sendTx(svm, payer, [
    createMintToInstruction(mintX.publicKey, payerAtaX, payer.publicKey, 100_000_000_000n),
  ]);
  logMem("minted X");

  console.log("F2. Mint Y tokens");
  sendTx(svm, payer, [
    createMintToInstruction(mintY.publicKey, payerAtaY, payer.publicKey, 100_000_000_000_000n),
  ]);
  logMem("minted Y");

  console.log("G. Initialize pool");
  const { instructions, poolAddress } = Hadron.initialize(payer.publicKey, {
    mintX: mintX.publicKey, mintY: mintY.publicKey,
    authority: payer.publicKey, initialMidpriceQ32: toQ32(150.0),
  });
  sendTx(svm, payer, instructions);
  logMem("pool initialized");

  console.log("H. Load pool object");
  const pool = loadPool(svm, poolAddress);
  logMem("pool loaded");

  console.log("I. Set bid price curve");
  sendTx(svm, payer, [pool.setCurve(payer.publicKey, { side: Side.Bid, defaultInterpolation: Interpolation.Linear, slot: 0,
    points: [{ amountIn: 0n, priceFactor: 1.0 }, { amountIn: 500000000n, priceFactor: 0.995 }] })]);
  logMem("bid curve set");

  console.log("J. Set ask price curve");
  sendTx(svm, payer, [pool.setCurve(payer.publicKey, { side: Side.Ask, defaultInterpolation: Interpolation.Linear, slot: 0,
    points: [{ amountIn: 0n, priceFactor: 1.0 }, { amountIn: 75000000000n, priceFactor: 0.995 }] })]);
  logMem("ask curve set");

  console.log("K. Set risk curves");
  sendTx(svm, payer, [
    pool.setRiskCurve(payer.publicKey, { side: Side.Bid, defaultInterpolation: Interpolation.Linear, slot: 0,
      points: [{ pctBase: 0.0, priceFactor: 1.005 }, { pctBase: 0.5, priceFactor: 1.0 }, { pctBase: 1.0, priceFactor: 0.99 }] }),
  ]);
  sendTx(svm, payer, [
    pool.setRiskCurve(payer.publicKey, { side: Side.Ask, defaultInterpolation: Interpolation.Linear, slot: 0,
      points: [{ pctBase: 0.0, priceFactor: 0.99 }, { pctBase: 0.5, priceFactor: 1.0 }, { pctBase: 1.0, priceFactor: 1.005 }] }),
  ]);
  logMem("risk curves set");

  console.log("L. Create vault ATAs");
  createAta(svm, payer, pool.addresses.config, mintX.publicKey);
  createAta(svm, payer, pool.addresses.config, mintY.publicKey);
  logMem("vault atas created");

  console.log("M. Deposit");
  sendTx(svm, payer, [pool.deposit(payer.publicKey, { amountX: 5000000000n, amountY: 750000000000n })]);
  logMem("deposited");

  console.log("N. Swap (bid)");
  sendTx(svm, payer, [pool.swap(payer.publicKey, { isX: true, amountIn: 100000000n, minOut: 0n, feeRecipient })]);
  logMem("swapped");

  console.log("\nAll steps passed!");
}

main().catch(e => { console.error(e); process.exit(1); });
