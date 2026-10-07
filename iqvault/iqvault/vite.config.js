import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { llmProxyPlugin, buildLlmEnvFlags } from "./vite-llm-proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const llmEnv = buildLlmEnvFlags(env);

  return {
    plugins: [react(), llmProxyPlugin(env)],
    define: {
      __IQVAULT_LLM_ENV__: JSON.stringify(llmEnv),
    },
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
    },
    preview: {
      host: true,
      port: 4174,
    },
  };
});
