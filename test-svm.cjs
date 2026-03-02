const { LiteSVM, FeatureSet } = require("litesvm");
const { PublicKey, Keypair, Transaction, Connection } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, MintLayout, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createMintToInstruction } = require("@solana/spl-token");
const { Hadron, toQ32, Interpolation, Side, HADRON_PROGRAM_ID, getFeeConfigAddress, decodeFeeConfig, decodeConfig, decodeMidpriceOracle, decodeCurveMeta, derivePoolAddresses } = require("@hadron-fi/sdk");
const path = require("path");

const PROGRAM_PATH = path.resolve(__dirname, "programs/hadron.so");
const PROGRAM_ID = HADRON_PROGRAM_ID;

function logMem(label) {
  const used = process.memoryUsage();
  console.log(`  [${label}] rss=${Math.round(used.rss / 1024 / 1024)}MB heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
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
  const configData = svm.getAccount(addr);
  const config = decodeConfig(new Uint8Array(configData.data));
  const addrs = derivePoolAddresses(config.seed, config.mintX, config.mintY, config.tokenProgramX, config.tokenProgramY, HADRON_PROGRAM_ID);
  return new Hadron(null, addr, addrs, config,
    decodeMidpriceOracle(new Uint8Array(svm.getAccount(addrs.midpriceOracle).data)),
    decodeCurveMeta(new Uint8Array(svm.getAccount(addrs.curveMeta).data)),
    new Uint8Array(svm.getAccount(addrs.curvePrefabs).data), HADRON_PROGRAM_ID);
}

async function main() {
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");
  const [feeConfigPda] = getFeeConfigAddress();
  const feeConfigAcct = await conn.getAccountInfo(feeConfigPda);
  if (!feeConfigAcct) throw new Error("Fee config not found");
  const feeRecipient = decodeFeeConfig(feeConfigAcct.data).feeRecipient;

  const svm = LiteSVM.default()
    .withFeatureSet(FeatureSet.allEnabled())
    .withSigverify(false)
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms()
    .withLamports(1000000000000000n);
  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_PATH);
  svm.setAccount(feeConfigPda, {
    lamports: BigInt(feeConfigAcct.lamports),
    data: Buffer.from(feeConfigAcct.data),
    owner: HADRON_PROGRAM_ID,
    executable: false,
  });

  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, 100000000000000n);
  svm.airdrop(feeRecipient, 1000000000n);

  const mintX = Keypair.generate();
  const mintY = Keypair.generate();
  createMint(svm, payer, mintX, 6);
  createMint(svm, payer, mintY, 6);

  createAta(svm, payer, feeRecipient, mintX.publicKey);
  createAta(svm, payer, feeRecipient, mintY.publicKey);
  const payerAtaX = createAta(svm, payer, payer.publicKey, mintX.publicKey);
  const payerAtaY = createAta(svm, payer, payer.publicKey, mintY.publicKey);
  sendTx(svm, payer, [
    createMintToInstruction(mintX.publicKey, payerAtaX, payer.publicKey, BigInt("1000000000000000000")),
    createMintToInstruction(mintY.publicKey, payerAtaY, payer.publicKey, BigInt("1000000000000000000")),
  ]);
  logMem("setup done");

  // Step by step — one pool
  console.log("\n1. Initialize pool");
  const { instructions, poolAddress } = Hadron.initialize(payer.publicKey, {
    mintX: mintX.publicKey, mintY: mintY.publicKey,
    authority: payer.publicKey, initialMidpriceQ32: toQ32(150.0),
  });
  sendTx(svm, payer, instructions);
  logMem("initialized");

  console.log("2. Load pool");
  const pool = loadPool(svm, poolAddress);
  logMem("loaded");

  console.log("3. Set bid price curve");
  sendTx(svm, payer, [pool.setCurve(payer.publicKey, { side: Side.Bid, defaultInterpolation: Interpolation.Linear, slot: 0,
    points: [{ amountIn: 0n, priceFactor: 1.0 }, { amountIn: 500000000n, priceFactor: 0.995 }] })]);
  logMem("bid curve");

  console.log("4. Set ask price curve");
  sendTx(svm, payer, [pool.setCurve(payer.publicKey, { side: Side.Ask, defaultInterpolation: Interpolation.Linear, slot: 0,
    points: [{ amountIn: 0n, priceFactor: 1.0 }, { amountIn: 75000000000n, priceFactor: 0.995 }] })]);
  logMem("ask curve");

  console.log("5. Set bid risk curve");
  sendTx(svm, payer, [pool.setRiskCurve(payer.publicKey, { side: Side.Bid, defaultInterpolation: Interpolation.Linear, slot: 0,
    points: [{ pctBase: 0.0, priceFactor: 1.005 }, { pctBase: 0.5, priceFactor: 1.0 }, { pctBase: 1.0, priceFactor: 0.99 }] })]);
  logMem("bid risk");

  console.log("6. Set ask risk curve");
  sendTx(svm, payer, [pool.setRiskCurve(payer.publicKey, { side: Side.Ask, defaultInterpolation: Interpolation.Linear, slot: 0,
    points: [{ pctBase: 0.0, priceFactor: 0.99 }, { pctBase: 0.5, priceFactor: 1.0 }, { pctBase: 1.0, priceFactor: 1.005 }] })]);
  logMem("ask risk");

  console.log("7. Create vault ATAs");
  createAta(svm, payer, pool.addresses.config, mintX.publicKey);
  createAta(svm, payer, pool.addresses.config, mintY.publicKey);
  logMem("vault atas");

  console.log("8. Deposit");
  sendTx(svm, payer, [pool.deposit(payer.publicKey, { amountX: 5000000000n, amountY: 750000000000n })]);
  logMem("deposited");

  console.log("9. Swap (bid)");
  sendTx(svm, payer, [pool.swap(payer.publicKey, { isX: true, amountIn: 100000000n, minOut: 0n, feeRecipient })]);
  logMem("swapped");

  console.log("\nAll steps passed!");
}

main().catch(e => { console.error(e); process.exit(1); });
