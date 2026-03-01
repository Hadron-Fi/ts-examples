import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
