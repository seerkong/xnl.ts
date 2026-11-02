import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/overlay-materialization.ts",
    "src/revisioned-persistence.ts",
    "src/persistence-mode.ts",
    "src/local-fs-persistence.ts",
    "src/indexeddb-persistence.ts",
    "src/content-history.ts",
    "src/xnl-content-history.ts",
    "src/indexeddb-content-history.ts",
    "src/local-fs-content-history.ts",
    "src/file-workspace.ts",
    "src/managed-fs-workspace.ts",
    "src/indexeddb-backup.ts",
    "src/text-content-history.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  treeshake: true,
});
