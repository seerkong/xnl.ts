import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/revisioned-persistence.ts",
    "src/persistence-mode.ts",
    "src/local-fs-persistence.ts",
    "src/indexeddb-persistence.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  treeshake: true,
});
