import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Go server runs on :8080. Same-origin proxying keeps the
// session cookie and WebSocket origin check identical to production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900 },
});
