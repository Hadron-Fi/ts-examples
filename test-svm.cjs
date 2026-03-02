const { LiteSVM, FeatureSet } = require("litesvm");
const { PublicKey } = require("@solana/web3.js");
const path = require("path");

const PROGRAM_PATH = path.resolve(__dirname, "programs/hadron.so");
const PROGRAM_ID = new PublicKey("hdrn4UEBJFjPEuUQnmRoA7YoXMeTcXVvMmME8sNFEkP");

// Test: Memory pressure with explicit GC — does native memory get freed?
console.log("Test: Create + discard 20 SVM instances (with --expose-gc)...");
if (!global.gc) {
  console.log("SKIP — run with: node --expose-gc test-svm.cjs");
  process.exit(0);
}

for (let i = 0; i < 20; i++) {
  let s = LiteSVM.default()
    .withFeatureSet(FeatureSet.allEnabled())
    .withSigverify(false)
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms()
    .withLamports(1000000000000000n);
  s.addProgramFromFile(PROGRAM_ID, PROGRAM_PATH);
  s = null;
  global.gc();
  const used = process.memoryUsage();
  console.log(`  Instance ${i}: rss=${Math.round(used.rss / 1024 / 1024)}MB heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
}
console.log("PASS");
