console.log("1. Loading litesvm...");
const { LiteSVM, FeatureSet } = require("litesvm");
console.log("   OK");

console.log("2. Loading @solana/web3.js (basic)...");
const { PublicKey, Keypair, Transaction } = require("@solana/web3.js");
console.log("   OK");

console.log("3. Loading @solana/web3.js (Connection)...");
const { Connection } = require("@solana/web3.js");
console.log("   OK");

console.log("4. Loading @solana/spl-token...");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
console.log("   OK");

console.log("5. Loading @hadron-fi/sdk (basic)...");
const { Hadron, toQ32, HADRON_PROGRAM_ID } = require("@hadron-fi/sdk");
console.log("   OK");

console.log("6. Loading @hadron-fi/sdk (decoders)...");
const { getFeeConfigAddress, decodeFeeConfig, decodeConfig, decodeMidpriceOracle, decodeCurveMeta, derivePoolAddresses } = require("@hadron-fi/sdk");
console.log("   OK");

console.log("\nAll imports succeeded!");
const used = process.memoryUsage();
console.log(`rss=${Math.round(used.rss / 1024 / 1024)}MB heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
