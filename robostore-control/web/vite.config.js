import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    // Only used for `npm run dev`; the bridge serves the built app in production.
    proxy: {
      "/ws": { target: "ws://127.0.0.1:7780", ws: true },
    },
  },
});
