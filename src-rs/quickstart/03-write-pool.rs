/// Example: Write pool updates and execute swaps.
///
/// Loads the pool created by init-pool (from output/pool-config.json)
/// and demonstrates SDK methods that market makers use to update pool
/// parameters in real time:
///
///   1. updateMidprice — push a new midprice to the oracle
///   2. updateBaseSpread — widen/narrow the base spread
///   3. updateMidpriceAndBaseSpread — atomic update of both
///   4. submitCurveUpdates — queue point edits to the price curve
///   5. Swap — pending curve updates are applied during the swap
///
/// Run:
///   cargo run --bin write
///   POOL=<address> cargo run --bin write
#[allow(dead_code, deprecated)]
#[path = "../setup.rs"]
mod setup;

use hadron_sdk::{
    accounts::decode_fee_config,
    helpers::derive::get_fee_config_address,
    helpers::math::{from_q32, spread_bps_to_q32, to_q32},
    types::*,
    Hadron,
};
use setup::*;

fn main() {
    let entry = load_pool_config();
    let pool_address = parse_pool_address(&entry);
    let authority = load_authority(&entry);
    let payer = load_wallet();
    let rpc = rpc_client();

    log_header("Load existing pool");
    log_info("Pool:", &pool_address.to_string());
    log_info("Authority:", &authority.pubkey().to_string());
    log_info("Payer:", &payer.pubkey().to_string());

    let pool = Hadron::load(&rpc, &pool_address).expect("Failed to load pool");
    let program_id = pool.program_id;

    // Resolve fee recipient for swaps
    let (fee_config_pda, _) = get_fee_config_address(&program_id);
    let fee_config_acct = rpc
        .get_account(&fee_config_pda)
        .expect("Fee config not found");
    let fee_config = decode_fee_config(&fee_config_acct.data).expect("Failed to decode fee config");
    let fee_recipient = fee_config.fee_recipient;

    // ------------------------------------------------------------------
    // Setup: fund authority with tokens for swapping
    // ------------------------------------------------------------------
    log_header("Setup: fund authority for swaps");
    let mint_x = pool.config.mint_x;
    let mint_y = pool.config.mint_y;
    let user_ata_x = create_ata(&rpc, &payer, &authority.pubkey(), &mint_x);
    let user_ata_y = create_ata(&rpc, &payer, &authority.pubkey(), &mint_y);
    create_ata(&rpc, &payer, &fee_recipient, &mint_x);
    create_ata(&rpc, &payer, &fee_recipient, &mint_y);
    mint_to(&rpc, &payer, &mint_x, &user_ata_x, 10_000_000_000); // 10k X
    mint_to(&rpc, &payer, &mint_y, &user_ata_y, 10_000_000_000); // 10k Y
    log_info("Minted:", "10,000 X + 10,000 Y to authority");

    // ------------------------------------------------------------------
    // 1. updateMidprice — move the midprice to 155
    // ------------------------------------------------------------------
    log_header("updateMidprice");
    let ix = pool.update_midprice(
        &authority.pubkey(),
        &UpdateMidpriceParams {
            midprice_q32: to_q32(155.0),
            sequence: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Midprice → 155", &sig);

    // ------------------------------------------------------------------
    // 2. updateBaseSpread — set a 10 bps base spread
    // ------------------------------------------------------------------
    log_header("updateBaseSpread");
    let ix = pool.update_base_spread(
        &authority.pubkey(),
        &UpdateBaseSpreadParams {
            spread_factor_q32: spread_bps_to_q32(10),
            sequence: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Base spread → 10 bps", &sig);

    // ------------------------------------------------------------------
    // 3. updateMidpriceAndBaseSpread — atomic update
    // ------------------------------------------------------------------
    log_header("updateMidpriceAndBaseSpread");
    let ix = pool.update_midprice_and_base_spread(
        &authority.pubkey(),
        &UpdateMidpriceAndBaseSpreadParams {
            midprice_q32: to_q32(158.0),
            spread_factor_q32: spread_bps_to_q32(5),
            sequence: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Midprice → 158, spread → 5 bps", &sig);

    // ------------------------------------------------------------------
    // 4. submitCurveUpdates — queue edits to price curve points
    // ------------------------------------------------------------------
    log_header("submitCurveUpdates");

    let curves = pool.get_active_curves().expect("Failed to decode curves");
    let bid_pts = &curves.price_bid.points;
    log_info("Current bid curve:", &format!("{} points", bid_pts.len()));
    for (i, pt) in bid_pts.iter().take(3).enumerate() {
        log_info(
            &format!("  [{}]", i),
            &format!(
                "amountIn={} factor={:.6}",
                pt.amount_in,
                from_q32(pt.price_factor_q32)
            ),
        );
    }

    let ops = vec![
        CurveUpdateOp {
            curve_type: CurveType::PriceBid,
            op_kind: CurveUpdateOpKind::Edit,
            point_index: 0,
            interpolation: Interpolation::Linear,
            amount_in: bid_pts[0].amount_in,
            price_factor_q32: to_q32(0.999),
            params: [0; 4],
        },
        CurveUpdateOp {
            curve_type: CurveType::PriceBid,
            op_kind: CurveUpdateOpKind::Edit,
            point_index: 1,
            interpolation: Interpolation::Linear,
            amount_in: bid_pts[1].amount_in,
            price_factor_q32: to_q32(0.9995),
            params: [0; 4],
        },
        CurveUpdateOp {
            curve_type: CurveType::PriceBid,
            op_kind: CurveUpdateOpKind::Edit,
            point_index: 2,
            interpolation: Interpolation::Linear,
            amount_in: bid_pts[2].amount_in,
            price_factor_q32: to_q32(0.999),
            params: [0; 4],
        },
    ];

    let ix = pool.submit_curve_updates(&authority.pubkey(), &ops);
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx(
        &format!("Submit {} curve update ops (edit x{})", ops.len(), ops.len()),
        &sig,
    );
    log_info("Note:", "Updates are queued — they apply on the next swap.");

    // ------------------------------------------------------------------
    // 5. Swap — sell 10 X (bid side, applies pending updates)
    // ------------------------------------------------------------------
    log_header("Swap: sell 10 X (bid side, applies pending updates)");
    let ix = pool.swap(
        &authority.pubkey(),
        &SwapParams {
            is_x: true,
            amount_in: 10_000_000,
            min_out: 0,
            fee_recipient,
            expiration: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Swap 10 X → Y", &sig);

    // ------------------------------------------------------------------
    // 6. Swap the other direction — buy X with Y (ask side)
    // ------------------------------------------------------------------
    log_header("Swap: sell 100 Y (ask side)");
    let ix = pool.swap(
        &authority.pubkey(),
        &SwapParams {
            is_x: false,
            amount_in: 100_000_000,
            min_out: 0,
            fee_recipient,
            expiration: None,
        },
    );
    let sig = send_ix(&rpc, ix, &payer, &[&authority]);
    log_tx("Swap 100 Y → X", &sig);

    log_header("Done! All update methods exercised.");
}
