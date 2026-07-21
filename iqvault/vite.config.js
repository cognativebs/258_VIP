import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    open: "/",
    proxy: {
      "/api/comics": {
        target: "http://127.0.0.1:5200",
        changeOrigin: true,
      },
      "/api/orchestr8": {
        target: "http://127.0.0.1:5210",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/orchestr8/, ""),
      },
    },
  },
  preview: {
    host: true,
    port: 4174,
    proxy: {
      "/api/comics": {
        target: "http://127.0.0.1:5200",
        changeOrigin: true,
      },
      "/api/orchestr8": {
        target: "http://127.0.0.1:5210",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/orchestr8/, ""),
      },
    },
  },
});
