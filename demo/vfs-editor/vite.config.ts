import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// xnl-vfs/xnl-vcs hash via node:crypto (createHash). Polyfill node builtins so the
// libs run in the browser unchanged (sha256 stays identical). protocolImports:true
// handles the `node:` prefixed imports.
export default defineConfig({
  plugins: [vue(), nodePolyfills({ protocolImports: true })],
  server: { port: 5174 },
});
