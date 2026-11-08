import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@deploy": fileURLToPath(new URL("../deployments/testnet.json", import.meta.url)),
      "@evidence": fileURLToPath(new URL("../docs/evidence.json", import.meta.url)),
      "@core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { fs: { allow: [".."] }, port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
