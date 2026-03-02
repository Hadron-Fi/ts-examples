const { LiteSVM, FeatureSet } = require("litesvm");
const { PublicKey } = require("@solana/web3.js");
const path = require("path");

const PROGRAM_PATH = path.resolve(__dirname, "programs/hadron.so");
const PROGRAM_ID = new PublicKey("hdrn4UEBJFjPEuUQnmRoA7YoXMeTcXVvMmME8sNFEkP");

// Test 1: Can we create multiple SVM instances?
console.log("Test 1: Create 5 SVM instances sequentially...");
for (let i = 0; i < 5; i++) {
  const svm = LiteSVM.default()
    .withFeatureSet(FeatureSet.allEnabled())
    .withSigverify(false)
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms()
    .withLamports(1000000000000000n);
  console.log("  SVM instance", i, "OK");
}
console.log("PASS\n");

// Test 2: Load the program
console.log("Test 2: Create SVM + load hadron.so...");
const svm = LiteSVM.default()
  .withFeatureSet(FeatureSet.allEnabled())
  .withSigverify(false)
  .withBuiltins()
  .withSysvars()
  .withDefaultPrograms()
  .withLamports(1000000000000000n);
svm.addProgramFromFile(PROGRAM_ID, PROGRAM_PATH);
console.log("PASS\n");

// Test 3: Memory pressure — create + discard in a loop
console.log("Test 3: Create + discard 20 SVM instances with program loaded...");
for (let i = 0; i < 20; i++) {
  const s = LiteSVM.default()
    .withFeatureSet(FeatureSet.allEnabled())
    .withSigverify(false)
    .withBuiltins()
    .withSysvars()
    .withDefaultPrograms()
    .withLamports(1000000000000000n);
  s.addProgramFromFile(PROGRAM_ID, PROGRAM_PATH);
  const used = process.memoryUsage();
  console.log(`  Instance ${i}: rss=${Math.round(used.rss / 1024 / 1024)}MB heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
}
console.log("PASS\n");

console.log("All tests passed.");
