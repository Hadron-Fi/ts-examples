/// Example: Read pool state from devnet.
///
/// Loads the pool created by the TS init script (from output/pool-config.json)
/// and prints all key state: midprice, spread, active curves with decoded
/// points, vault balances, and oracle metadata.
///
/// Prerequisites:
///   Run the TypeScript init script first: npm run init
///
/// Run:
///   cargo run --bin read
///   POOL=<address> cargo run --bin read
#[allow(dead_code, deprecated)]
#[path = "../setup.rs"]
mod setup;

use hadron_sdk::{
    helpers::math::from_q32,
    types::{CurveSide, CurveXMode, Interpolation},
    Hadron,
};
use setup::*;

fn interp_name(i: Interpolation) -> &'static str {
    match i {
        Interpolation::Step => "Step",
        Interpolation::Linear => "Linear",
        Interpolation::MarginalStep => "MarginalStep",
        Interpolation::Hyperbolic => "Hyperbolic",
        Interpolation::Quadratic => "Quadratic",
        Interpolation::Cubic => "Cubic",
    }
}

fn x_mode_name(m: CurveXMode) -> &'static str {
    match m {
        CurveXMode::Native => "Native",
        CurveXMode::Alternate => "Alternate",
    }
}

fn format_curve(label: &str, curve: &CurveSide, is_risk: bool) {
    let x_label = if is_risk { "X (pct/abs)" } else { "X (amountIn)" };
    log_info(
        &format!("  {}:", label),
        &format!(
            "{} points, interp={}, xMode={}",
            curve.num_points,
            interp_name(curve.default_interpolation),
            x_mode_name(curve.x_mode),
        ),
    );
    for pt in &curve.points {
        let x = if is_risk {
            format!("{:.6}", from_q32(pt.amount_in))
        } else {
            pt.amount_in.to_string()
        };
        let factor = from_q32(pt.price_factor_q32);
        log_info(
            &format!("    {}={}", x_label, x),
            &format!("factor={:.8}  interp={}", factor, interp_name(pt.interpolation)),
        );
    }
}

fn main() {
    let entry = load_pool_config();
    let pool_address = parse_pool_address(&entry);
    let rpc = rpc_client();

    // ------------------------------------------------------------------
    // Load pool
    // ------------------------------------------------------------------
    log_header("Loading pool");
    let pool = Hadron::load(&rpc, &pool_address).expect("Failed to load pool");

    // ------------------------------------------------------------------
    // Basic info
    // ------------------------------------------------------------------
    log_header("Pool Info");
    log_info("Address:", &pool_address.to_string());
    log_info("Authority:", &pool.config.authority.to_string());
    log_info("Mint X:", &pool.config.mint_x.to_string());
    log_info("Mint Y:", &pool.config.mint_y.to_string());
    log_info("Seed:", &pool.config.seed.to_string());

    // ------------------------------------------------------------------
    // Midprice & spread
    // ------------------------------------------------------------------
    log_header("Oracle");
    let midprice = pool.get_midprice();
    let spread_factor = pool.get_spread_factor();
    let spread_bps = pool.get_spread_bps();
    log_info("Midprice:", &format!("{:.6}", midprice));
    log_info(
        "Spread Factor:",
        &format!("{:.8} ({:.2} bps)", spread_factor, spread_bps),
    );
    log_info("Sequence:", &pool.oracle.sequence.to_string());
    log_info("Last Update Slot:", &pool.oracle.last_update_slot.to_string());

    // ------------------------------------------------------------------
    // Active curve slots
    // ------------------------------------------------------------------
    log_header("Active Curve Slots");
    let slots = pool.get_active_curve_slots();
    log_info("Price Bid:", &format!("slot {}", slots.price_bid));
    log_info("Price Ask:", &format!("slot {}", slots.price_ask));
    log_info("Risk Bid:", &format!("slot {}", slots.risk_bid));
    log_info("Risk Ask:", &format!("slot {}", slots.risk_ask));

    // ------------------------------------------------------------------
    // Decoded curves
    // ------------------------------------------------------------------
    log_header("Active Curves");
    let curves = pool.get_active_curves().expect("Failed to decode curves");
    format_curve("Price Bid", &curves.price_bid, false);
    format_curve("Price Ask", &curves.price_ask, false);
    format_curve("Risk Bid", &curves.risk_bid, true);
    format_curve("Risk Ask", &curves.risk_ask, true);

    // ------------------------------------------------------------------
    // Vault balances
    // ------------------------------------------------------------------
    log_header("Vault Balances");
    match rpc.get_token_account_balance(&pool.addresses.vault_x) {
        Ok(bal) => log_info(
            "Vault X:",
            &format!("{} ({} atoms)", bal.ui_amount_string, bal.amount),
        ),
        Err(_) => log_info("Vault X:", "(not found or empty)"),
    }
    match rpc.get_token_account_balance(&pool.addresses.vault_y) {
        Ok(bal) => log_info(
            "Vault Y:",
            &format!("{} ({} atoms)", bal.ui_amount_string, bal.amount),
        ),
        Err(_) => log_info("Vault Y:", "(not found or empty)"),
    }

    log_header("Done!");
}
