import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/revisioned-repository.ts",
    "src/indexeddb-backend.ts",
    "src/transactional-backend.ts",
    "src/document-history.ts",
    "src/workspace-history.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  treeshake: true,
});
