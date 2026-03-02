/// Example: Initialize a Hadron pool and configure price + risk curves.
///
/// Walks through the full lifecycle:
///   1. Create two token mints
///   2. Initialize the pool
///   3. Set price curves (bid + ask)
///   4. Set risk curves (bid + ask)
///   5. Deposit liquidity
///   6. Update the midprice oracle
///   7. Save pool config to output/
///
/// Run:
///   cargo run --bin init-pool
#[allow(dead_code, deprecated)]
#[path = "../setup.rs"]
mod setup;

use hadron_sdk::{
    constants::HADRON_PROGRAM_ID,
    helpers::math::to_q32,
    types::*,
    Hadron,
};
use solana_sdk::signature::Keypair;
use setup::*;

fn main() {
    let rpc = rpc_client();
    let payer = load_wallet();
    let program_id = HADRON_PROGRAM_ID;

    log_header("Step 1 — Create token mints");
    log_info("Payer:", &payer.pubkey().to_string());

    // Check payer balance
    let balance = rpc.get_balance(&payer.pubkey()).expect("Failed to get balance");
    log_info("Balance:", &format!("{:.4} SOL", balance as f64 / 1e9));
    if balance < 50_000_000 {
        panic!("Payer balance too low. Fund it: solana airdrop 5 --keypair wallet.json --url devnet");
    }

    // Create two token mints (X = base, Y = quote, 6 decimals each)
    let mint_x = Keypair::new();
    let mint_y = Keypair::new();
    let sig = create_mint(&rpc, &payer, &mint_x, 6);
    log_tx("Mint X created", &sig);
    log_info("Mint X:", &mint_x.pubkey().to_string());

    let sig = create_mint(&rpc, &payer, &mint_y, 6);
    log_tx("Mint Y created", &sig);
    log_info("Mint Y:", &mint_y.pubkey().to_string());

    // Authority for the pool
    let authority = Keypair::new();

    // ---------------------------------------------------------------
    // 2. Initialize the pool
    // ---------------------------------------------------------------
    log_header("Step 2 — Initialize pool");
    let initial_midprice = 150.0; // e.g. 150 USDC per token

    let init_params = InitializeParams {
        seed: None, // auto-generate
        mint_x: mint_x.pubkey(),
        mint_y: mint_y.pubkey(),
        authority: authority.pubkey(),
        initial_midprice_q32: to_q32(initial_midprice),
        oracle_mode: None,
        max_prefab_slots: Some(3),
        max_curve_points: None,
        token_program_x: Some(spl_token::id()),
        token_program_y: Some(spl_token::id()),
    };

    let (instructions, pool_address, seed) =
        Hadron::initialize(&payer.pubkey(), &init_params, &program_id);

    // The allocate instruction(s) and initialize go in one transaction
    let sig = send_ixs(&rpc, &instructions, &payer, &[]);
    log_tx("Initialize", &sig);
    log_info("Pool address:", &pool_address.to_string());
    log_info("Seed:", &seed.to_string());
    log_explorer("View on Solscan:", &pool_address.to_string());

    // Load the pool object
    let pool = Hadron::load(&rpc, &pool_address).expect("Failed to load pool");

    // ---------------------------------------------------------------
    // 3. Set price curves (bid + ask)
    // ---------------------------------------------------------------
    log_header("Step 3 — Set price curves (bid + ask, 11 points each)");

    let bid_price_points: Vec<SetCurvePointInput> = vec![
        SetCurvePointInput { amount_in: 0,               price_factor_q32: to_q32(1.0),     interpolation: None, params: None },
        SetCurvePointInput { amount_in: 100_000_000,     price_factor_q32: to_q32(0.99933), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 250_000_000,     price_factor_q32: to_q32(0.99867), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 500_000_000,     price_factor_q32: to_q32(0.99794), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 750_000_000,     price_factor_q32: to_q32(0.99244), interpolation: None, params: None }, // +50 bps kink
        SetCurvePointInput { amount_in: 1_000_000_000,   price_factor_q32: to_q32(0.99206), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 1_500_000_000,   price_factor_q32: to_q32(0.99149), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 2_000_000_000,   price_factor_q32: to_q32(0.99106), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 2_500_000_000,   price_factor_q32: to_q32(0.99073), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 3_000_000_000,   price_factor_q32: to_q32(0.99045), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 4_000_000_000,   price_factor_q32: to_q32(0.99000), interpolation: None, params: None }, // -100 bps
    ];

    let ix = pool.set_curve(
        &authority.pubkey(),
        &SetCurveParams {
            side: Side::Bid,
            default_interpolation: Interpolation::Linear,
            slot: Some(0),
            x_mode: None,
            points: bid_price_points,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Price curve (bid — 11 points, kinked)", &sig);

    let ask_price_points: Vec<SetCurvePointInput> = vec![
        SetCurvePointInput { amount_in: 0,                 price_factor_q32: to_q32(1.0),     interpolation: None, params: None },
        SetCurvePointInput { amount_in: 15_000_000_000,    price_factor_q32: to_q32(0.99933), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 37_500_000_000,    price_factor_q32: to_q32(0.99867), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 75_000_000_000,    price_factor_q32: to_q32(0.99794), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 112_500_000_000,   price_factor_q32: to_q32(0.99244), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 150_000_000_000,   price_factor_q32: to_q32(0.99206), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 225_000_000_000,   price_factor_q32: to_q32(0.99149), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 300_000_000_000,   price_factor_q32: to_q32(0.99106), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 375_000_000_000,   price_factor_q32: to_q32(0.99073), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 450_000_000_000,   price_factor_q32: to_q32(0.99045), interpolation: None, params: None },
        SetCurvePointInput { amount_in: 600_000_000_000,   price_factor_q32: to_q32(0.99000), interpolation: None, params: None },
    ];

    let ix = pool.set_curve(
        &authority.pubkey(),
        &SetCurveParams {
            side: Side::Ask,
            default_interpolation: Interpolation::Linear,
            slot: Some(0),
            x_mode: None,
            points: ask_price_points,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Price curve (ask — 11 points, kinked)", &sig);

    // ---------------------------------------------------------------
    // 4. Set risk curves (bid + ask)
    // ---------------------------------------------------------------
    log_header("Step 4 — Set risk curves (bid + ask, 5 points each)");

    let ix = pool.set_risk_curve(
        &authority.pubkey(),
        &SetRiskCurveParams {
            side: Side::Bid,
            default_interpolation: Interpolation::Linear,
            slot: Some(0),
            x_mode: None,
            risk_mode: None,
            points: vec![
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.0),  price_factor_q32: to_q32(1.005),  interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.25), price_factor_q32: to_q32(1.0025), interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.5),  price_factor_q32: to_q32(1.0),    interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.75), price_factor_q32: to_q32(0.9975), interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(1.0),  price_factor_q32: to_q32(0.990),  interpolation: None, params: None },
            ],
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Risk curve (bid)", &sig);

    let ix = pool.set_risk_curve(
        &authority.pubkey(),
        &SetRiskCurveParams {
            side: Side::Ask,
            default_interpolation: Interpolation::Linear,
            slot: Some(0),
            x_mode: None,
            risk_mode: None,
            points: vec![
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.0),  price_factor_q32: to_q32(0.990),  interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.25), price_factor_q32: to_q32(0.9975), interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.5),  price_factor_q32: to_q32(1.0),    interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(0.75), price_factor_q32: to_q32(1.0025), interpolation: None, params: None },
                SetRiskCurvePointInput { pct_base_q32: to_q32(1.0),  price_factor_q32: to_q32(1.005),  interpolation: None, params: None },
            ],
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Risk curve (ask)", &sig);

    // ---------------------------------------------------------------
    // 5. Deposit liquidity
    // ---------------------------------------------------------------
    log_header("Step 5 — Deposit liquidity");

    // Create vault ATAs (config PDA owns the vaults)
    create_ata(&rpc, &payer, &pool.addresses.config, &mint_x.pubkey());
    create_ata(&rpc, &payer, &pool.addresses.config, &mint_y.pubkey());

    // Create authority ATAs and mint tokens
    let user_ata_x = create_ata(&rpc, &payer, &authority.pubkey(), &mint_x.pubkey());
    let user_ata_y = create_ata(&rpc, &payer, &authority.pubkey(), &mint_y.pubkey());
    mint_to(&rpc, &payer, &mint_x.pubkey(), &user_ata_x, 10_000_000_000); // 10k X
    mint_to(&rpc, &payer, &mint_y.pubkey(), &user_ata_y, 1_500_000_000_000); // 1.5M Y

    // 50/50 value deposit: 5,000 X ($750k) + 750,000 Y ($750k)
    let ix = pool.deposit(
        &authority.pubkey(),
        &DepositParams {
            amount_x: 5_000_000_000,     // 5,000 X
            amount_y: 750_000_000_000,   // 750,000 Y
            expiration: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Deposit 5,000 X + 750,000 Y (50/50 value)", &sig);

    // ---------------------------------------------------------------
    // 6. Update the midprice oracle
    // ---------------------------------------------------------------
    log_header("Step 6 — Update midprice oracle");

    let ix = pool.update_midprice(
        &authority.pubkey(),
        &UpdateMidpriceParams {
            midprice_q32: to_q32(152.5),
            sequence: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Midprice -> 152.5", &sig);

    // ---------------------------------------------------------------
    // 7. Save pool config to output/
    // ---------------------------------------------------------------
    log_header("Step 7 — Save pool config to output/");

    let authority_key_file = save_keypair(
        &format!("authority-{}", &pool_address.to_string()[..8]),
        &authority,
    );

    save_pool_config(&PoolConfigEntry {
        pool_address: pool_address.to_string(),
        authority: authority.pubkey().to_string(),
        authority_key_file: Some(authority_key_file.clone()),
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    });

    log_info("Config appended:", "output/pool-config.json");
    log_info("Authority key:", &format!("output/{}", authority_key_file));

    log_header("Pool is live and ready for swaps!");
    log_info("Pool address:", &pool_address.to_string());
    log_explorer("View on Solscan:", &pool_address.to_string());
    log_info("Next steps:", "cargo run --bin read-pool     — inspect pool state");
    log_info("", "             cargo run --bin write-pool    — update midprice, curves, swap");
    log_info("", "             cargo run --bin spread-config — configure spread triggers");
}
