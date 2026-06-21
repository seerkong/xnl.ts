import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// Library build: Vue SFC component package. Heavy UI deps (vue, element-plus,
// ag-grid, monaco, pinia) and the xnl-* runtime libs are externalized — the
// consumer (e.g. demo/vfs-editor) provides them. Only this package's own source
// is bundled into the lib output.
const external = [
  "vue",
  "pinia",
  "element-plus",
  "@element-plus/icons-vue",
  "ag-grid-community",
  "ag-grid-vue3",
  "@guolao/vue-monaco-editor",
  "jszip",
  "idb",
  "xnl-core",
  "xnl-vfs",
  "xnl-vcs",
];

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "XnlVfsEditor",
      fileName: "xnl-vfs-editor",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      // externalize peer + runtime deps and any subpath import of them
      external: (id) => external.some((e) => id === e || id.startsWith(`${e}/`)),
      output: {
        globals: { vue: "Vue" },
      },
    },
    sourcemap: true,
    emptyOutDir: true,
  },
});
