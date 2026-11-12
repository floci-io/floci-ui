import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const usePolling = process.env.VITE_USE_POLLING === "true";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]react-router/.test(id)) return "react-vendor";
          if (/[\\/]react(-dom)?[\\/]/.test(id)) return "react-vendor";
          if (/[\\/]@tanstack[\\/]/.test(id)) return "query-vendor";
          if (/[\\/]lucide-react[\\/]/.test(id)) return "ui-vendor";
        },
      },
    },
  },
  server: {
    port: 4500,
    host: "0.0.0.0",
    allowedHosts: ["localhost", "127.0.0.1", "floci-ui"],
    watch: {
      usePolling,
    },
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:4501",
        changeOrigin: true,
      },
    },
  },
});
