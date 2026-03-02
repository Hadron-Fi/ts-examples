/**
 * Shared test harness for Hadron examples.
 *
 * Supports two modes controlled by env vars:
 *
 *   LiteSVM (default):
 *     npm test
 *
 *   Devnet:
 *     NETWORK=devnet WALLET=./wallet.json npm test
 *
 *   Custom RPC:
 *     NETWORK=devnet WALLET=./wallet.json RPC_URL=https://my-rpc.com npm test
 *
 * See .env.example for all options.
 */
import { LiteSVM, FeatureSet } from "litesvm";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  MintLayout,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
} from "@solana/spl-token";
import {
  Hadron,
  decodeConfig,
  decodeMidpriceOracle,
  decodeCurveMeta,
  derivePoolAddresses,
  HADRON_PROGRAM_ID,
} from "@hadron-fi/sdk";
import fs from "fs";
import path from "path";

export const PROGRAM_ID = HADRON_PROGRAM_ID;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(bytes: Buffer | Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "";
  for (const b of bytes) { if (b === 0) str += "1"; else break; }
  for (let i = digits.length - 1; i >= 0; i--) str += BASE58_ALPHABET[digits[i]];
  return str;
}

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

// ANSI colors for readable output on dark terminals
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Pretty-print a labeled transaction signature (Solscan link on devnet, raw sig otherwise). */
export function logTx(label: string, sig: string): void {
  if (isDevnet()) {
    process.stdout.write(`${GREEN}  ✓ ${label}${RESET} https://solscan.io/tx/${sig}?cluster=devnet\n`);
  } else {
    process.stdout.write(`${GREEN}  ✓ ${label}${RESET} ${DIM}${sig}${RESET}\n`);
  }
}

/** Print a key-value info line. */
export function logInfo(label: string, value: string): void {
  process.stdout.write(`${CYAN}  ${label}${RESET} ${value}\n`);
}

/** Print a Solscan devnet link for an account. */
export function logExplorer(label: string, address: string): void {
  if (isDevnet()) {
    process.stdout.write(`${CYAN}  ${label}${RESET} https://solscan.io/account/${address}?cluster=devnet\n`);
  }
}

/** Print a section header. */
export function logHeader(text: string): void {
  process.stdout.write(`\n${YELLOW}${text}${RESET}\n`);
}
const PROGRAM_PATH = path.resolve(__dirname, "../programs/hadron.so");

function isDevnet(): boolean {
  return process.env.NETWORK === "devnet";
}

export class TestHarness {
  readonly payer: Keypair;
  private svm?: LiteSVM;
  private connection?: Connection;

  constructor() {
    if (isDevnet()) {
      const walletPath = process.env.WALLET;
      if (!walletPath) {
        throw new Error("NETWORK=devnet requires WALLET=<path to keypair json>");
      }
      const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
      this.payer = Keypair.fromSecretKey(Uint8Array.from(raw));
      const rpcUrl = process.env.RPC_URL || DEFAULT_RPC_URL;
      this.connection = new Connection(rpcUrl, "confirmed");
      logHeader("Devnet mode");
      logInfo("RPC:", rpcUrl);
      logInfo("Payer:", this.payer.publicKey.toBase58());
    } else {
      this.svm = LiteSVM.default()
        .withFeatureSet(FeatureSet.allEnabled())
        .withSigverify(false)
        .withBuiltins()
        .withSysvars()
        .withDefaultPrograms()
        .withLamports(1_000_000_000_000_000n);

      this.svm.addProgramFromFile(PROGRAM_ID, PROGRAM_PATH);

      this.payer = Keypair.generate();
      this.svm.airdrop(this.payer.publicKey, 100_000_000_000n);
    }
  }

  /** Inject an account directly (LiteSVM only, no-op on devnet). */
  setAccount(
    address: PublicKey,
    account: { lamports: bigint; data: Buffer | Uint8Array; owner: PublicKey; executable: boolean }
  ): void {
    if (this.svm) {
      this.svm.setAccount(address, account);
    }
  }

  /** Get the RPC connection (devnet only, throws in LiteSVM mode). */
  getConnection(): Connection {
    if (this.connection) return this.connection;
    throw new Error("getConnection() is only available in devnet mode");
  }

  /** Whether running in LiteSVM (local) mode. */
  get isLocal(): boolean {
    return !!this.svm;
  }

  /** Fund an account with SOL. */
  async airdrop(address: PublicKey, lamports: bigint): Promise<void> {
    if (this.svm) {
      this.svm.airdrop(address, lamports);
    } else {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.payer.publicKey,
          toPubkey: address,
          lamports: Number(lamports),
        })
      );
      await sendAndConfirmTransaction(this.connection!, tx, [this.payer]);
    }
  }

  /** Create a token mint. Payer becomes mint authority. */
  async createMint(mintKeypair: Keypair, decimals: number = 6): Promise<void> {
    if (this.svm) {
      const data = Buffer.alloc(MintLayout.span);
      MintLayout.encode(
        {
          mintAuthorityOption: 1,
          mintAuthority: this.payer.publicKey,
          supply: 0n,
          decimals,
          isInitialized: true,
          freezeAuthorityOption: 0,
          freezeAuthority: PublicKey.default,
        },
        data
      );
      this.svm.setAccount(mintKeypair.publicKey, {
        lamports: 1_000_000_000n,
        data,
        owner: TOKEN_PROGRAM_ID,
        executable: false,
      });
    } else {
      const lamports = await this.connection!.getMinimumBalanceForRentExemption(
        MINT_SIZE
      );
      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: this.payer.publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          mintKeypair.publicKey,
          decimals,
          this.payer.publicKey,
          null
        )
      );
      await sendAndConfirmTransaction(this.connection!, tx, [
        this.payer,
        mintKeypair,
      ]);
    }
  }

  /** Create an Associated Token Account (skips if it already exists). */
  async createAta(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    if (this.svm) {
      if (this.svm.getAccount(ata)) return ata;
    } else {
      const info = await this.connection!.getAccountInfo(ata);
      if (info) return ata;
    }
    const ix = createAssociatedTokenAccountInstruction(
      this.payer.publicKey,
      ata,
      owner,
      mint
    );
    await this.sendIx(ix);
    return ata;
  }

  /** Mint tokens to a destination ATA. Payer must be mint authority. */
  async mintTo(
    mint: PublicKey,
    dest: PublicKey,
    amount: bigint
  ): Promise<void> {
    const ix = createMintToInstruction(
      mint,
      dest,
      this.payer.publicKey,
      amount
    );
    await this.sendIx(ix);
  }

  /** Send a single instruction. Returns the transaction signature. */
  async sendIx(
    ix: TransactionInstruction,
    signers?: Keypair[]
  ): Promise<string> {
    return this.sendIxs([ix], signers);
  }

  /** Send multiple instructions in one transaction. Returns the transaction signature. */
  async sendIxs(
    ixs: TransactionInstruction[],
    signers?: Keypair[]
  ): Promise<string> {
    return this._send(ixs, signers);
  }

  private async _send(
    ixs: TransactionInstruction[],
    signers?: Keypair[]
  ): Promise<string> {
    const tx = new Transaction();
    for (const ix of ixs) tx.add(ix);

    if (this.svm) {
      tx.feePayer = this.payer.publicKey;
      tx.recentBlockhash = this.svm.latestBlockhash();
      tx.sign(this.payer, ...(signers ?? []));

      const result = this.svm.sendTransaction(tx);
      if (typeof (result as any).err === "function") {
        const logs =
          typeof (result as any).meta === "function"
            ? (result as any).meta().logs()
            : [];
        throw new Error(
          `Transaction failed: ${(result as any).toString()}\nLogs: ${logs.join("\n")}`
        );
      }
      this.svm.expireBlockhash();
      return tx.signature ? bs58Encode(tx.signature) : "unknown";
    } else {
      return sendAndConfirmTransaction(this.connection!, tx, [
        this.payer,
        ...(signers ?? []),
      ]);
    }
  }

  /**
   * Load a Hadron pool instance.
   * LiteSVM doesn't expose a Connection, so we read accounts from SVM
   * state and construct the Hadron object directly.
   */
  async loadPool(poolAddress: PublicKey): Promise<Hadron> {
    if (this.connection) { // load from devnet
      return Hadron.load(this.connection, poolAddress);
    }

    // construct for liteSVM tests
    const configData = this.svm!.getAccount(poolAddress);
    if (!configData)
      throw new Error(`Pool not found: ${poolAddress.toBase58()}`);
    const config = decodeConfig(new Uint8Array(configData.data));

    const addrs = derivePoolAddresses(
      config.seed,
      config.mintX,
      config.mintY,
      config.tokenProgramX,
      config.tokenProgramY,
      PROGRAM_ID
    );

    const oracleData = this.svm!.getAccount(addrs.midpriceOracle);
    if (!oracleData) throw new Error("Oracle not found");
    const curveMetaData = this.svm!.getAccount(addrs.curveMeta);
    if (!curveMetaData) throw new Error("CurveMeta not found");
    const curvePrefabsData = this.svm!.getAccount(addrs.curvePrefabs);
    if (!curvePrefabsData) throw new Error("CurvePrefabs not found");

    return new Hadron(
      null as any,
      poolAddress,
      addrs,
      config,
      decodeMidpriceOracle(new Uint8Array(oracleData.data)),
      decodeCurveMeta(new Uint8Array(curveMetaData.data)),
      new Uint8Array(curvePrefabsData.data),
      PROGRAM_ID
    );
  }
}
