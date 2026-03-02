// Shared helpers for all Rust examples.
// Each binary includes this via `#[path = "setup.rs"] mod setup;`

use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
pub use solana_sdk::signer::Signer;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{Keypair, Signature},
    system_instruction,
    transaction::Transaction,
    instruction::Instruction,
};
/// SPL Mint account size (82 bytes).
const MINT_LEN: usize = 82;
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account,
};
use std::{fs, path::PathBuf, str::FromStr};

/// Pool config entry from output/pool-config.json.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolConfigEntry {
    pub pool_address: String,
    pub authority: String,
    pub authority_key_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// Resolve the output directory (project root / output).
pub fn output_dir() -> PathBuf {
    project_root().join("output")
}

/// Load the RPC client from env, defaulting to devnet.
pub fn rpc_client() -> RpcClient {
    // Load .env from project root regardless of CWD
    dotenv::from_path(project_root().join(".env")).ok();
    let url = std::env::var("RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    RpcClient::new_with_commitment(url, CommitmentConfig::confirmed())
}

/// Project root: hadron-examples/ (where Cargo.toml lives)
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Load a wallet keypair from the WALLET env var or wallet.json in the project root.
pub fn load_wallet() -> Keypair {
    let wallet_path = match std::env::var("WALLET") {
        Ok(p) => {
            let p = PathBuf::from(p);
            if p.is_absolute() {
                p
            } else {
                // Resolve relative paths against project root, not CWD
                project_root().join(p)
            }
        }
        Err(_) => project_root().join("wallet.json"),
    };
    let data = fs::read_to_string(&wallet_path)
        .unwrap_or_else(|_| panic!("Wallet not found at {}.\nRun: solana-keygen new -o wallet.json  (in hadron-examples/)", wallet_path.display()));
    let bytes: Vec<u8> = serde_json::from_str(&data).expect("Failed to parse wallet keypair");
    Keypair::from_bytes(&bytes).expect("Invalid keypair bytes")
}

/// Load the latest pool config entry. If POOL env is set, find that entry;
/// otherwise use the last entry in pool-config.json.
pub fn load_pool_config() -> PoolConfigEntry {
    let config_path = output_dir().join("pool-config.json");
    let data = fs::read_to_string(&config_path).unwrap_or_else(|_| {
        panic!(
            "output/pool-config.json not found at {}.\n\
             Run init-pool first: cargo run --bin init",
            config_path.display()
        )
    });
    let pools: Vec<PoolConfigEntry> = serde_json::from_str(&data)
        .expect("Failed to parse pool-config.json");

    if let Ok(addr) = std::env::var("POOL") {
        pools
            .into_iter()
            .find(|p| p.pool_address == addr)
            .unwrap_or_else(|| panic!("Pool {} not found in pool-config.json", addr))
    } else {
        pools
            .into_iter()
            .last()
            .expect("pool-config.json is empty")
    }
}

/// Load the authority keypair from the output directory.
pub fn load_authority(entry: &PoolConfigEntry) -> Keypair {
    let key_file = entry
        .authority_key_file
        .as_ref()
        .expect("No authorityKeyFile in pool config entry");
    let key_path = output_dir().join(key_file);
    let data = fs::read_to_string(&key_path)
        .unwrap_or_else(|_| panic!("Authority key file not found: {}", key_path.display()));
    let bytes: Vec<u8> = serde_json::from_str(&data).expect("Failed to parse authority keypair");
    Keypair::from_bytes(&bytes).expect("Invalid keypair bytes")
}

/// Parse a pool address string into a Pubkey.
pub fn parse_pool_address(entry: &PoolConfigEntry) -> Pubkey {
    Pubkey::from_str(&entry.pool_address).expect("Invalid pool address")
}

/// Send a single instruction, sign with payer + extra signers.
pub fn send_ix(
    rpc: &RpcClient,
    ix: Instruction,
    payer: &Keypair,
    signers: &[&Keypair],
) -> Signature {
    send_ixs(rpc, &[ix], payer, signers)
}

/// Send multiple instructions in one transaction.
pub fn send_ixs(
    rpc: &RpcClient,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Signature {
    let blockhash = rpc.get_latest_blockhash().expect("Failed to get blockhash");
    let mut all_signers: Vec<&dyn Signer> = vec![payer];
    for s in signers {
        all_signers.push(*s);
    }
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        &all_signers,
        blockhash,
    );
    rpc.send_and_confirm_transaction(&tx)
        .expect("Transaction failed")
}

/// Create a new SPL token mint (6 decimals) owned by payer.
pub fn create_mint(rpc: &RpcClient, payer: &Keypair, mint: &Keypair, decimals: u8) -> Signature {
    let rent = rpc.get_minimum_balance_for_rent_exemption(MINT_LEN).unwrap();
    let create_account_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        MINT_LEN as u64,
        &spl_token::id(),
    );
    let init_mint_ix = spl_token::instruction::initialize_mint(
        &spl_token::id(),
        &mint.pubkey(),
        &payer.pubkey(),
        None,
        decimals,
    )
    .unwrap();
    send_ixs(rpc, &[create_account_ix, init_mint_ix], payer, &[mint])
}

/// Create an associated token account. Returns the ATA address.
pub fn create_ata(
    rpc: &RpcClient,
    payer: &Keypair,
    owner: &Pubkey,
    mint: &Pubkey,
) -> Pubkey {
    let ata = get_associated_token_address_with_program_id(owner, mint, &spl_token::id());
    // Check if it already exists
    if rpc.get_account(&ata).is_ok() {
        return ata;
    }
    let ix = create_associated_token_account(
        &payer.pubkey(),
        owner,
        mint,
        &spl_token::id(),
    );
    send_ix(rpc, ix, payer, &[]);
    ata
}

/// Mint tokens to an ATA. Payer must be the mint authority.
pub fn mint_to(
    rpc: &RpcClient,
    payer: &Keypair,
    mint: &Pubkey,
    destination: &Pubkey,
    amount: u64,
) -> Signature {
    let ix = spl_token::instruction::mint_to(
        &spl_token::id(),
        mint,
        destination,
        &payer.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    send_ix(rpc, ix, payer, &[])
}

/// Save a pool config entry (append to pool-config.json).
pub fn save_pool_config(entry: &PoolConfigEntry) {
    let out = output_dir();
    fs::create_dir_all(&out).ok();
    let config_path = out.join("pool-config.json");

    let mut pools: Vec<serde_json::Value> = if config_path.exists() {
        let data = fs::read_to_string(&config_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };
    pools.push(serde_json::to_value(entry).unwrap());
    fs::write(&config_path, serde_json::to_string_pretty(&pools).unwrap()).unwrap();
}

/// Save a keypair to the output directory. Returns the filename.
pub fn save_keypair(name_prefix: &str, keypair: &Keypair) -> String {
    let out = output_dir();
    fs::create_dir_all(&out).ok();
    let filename = format!("{}.json", name_prefix);
    let path = out.join(&filename);
    let bytes: Vec<u8> = keypair.to_bytes().to_vec();
    fs::write(&path, serde_json::to_string(&bytes).unwrap()).unwrap();
    filename
}

// Logging helpers matching the TS style.
pub fn log_header(title: &str) {
    println!("\n\x1b[1;36m═══ {} ═══\x1b[0m", title);
}

pub fn log_info(label: &str, value: &str) {
    println!("  \x1b[90m{}\x1b[0m {}", label, value);
}

pub fn log_tx(label: &str, sig: &Signature) {
    println!(
        "  \x1b[32m✓\x1b[0m {} https://solscan.io/tx/{}?cluster=devnet",
        label, sig
    );
}

pub fn log_explorer(label: &str, address: &str) {
    println!(
        "  \x1b[90m{}\x1b[0m https://solscan.io/account/{}?cluster=devnet",
        label, address
    );
}
