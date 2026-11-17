import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so dist/index.html works when opened
  // directly from disk (file://) as well as from a server.
  base: "./",
  server: {
    // The feedback service stores corrections and runs retraining.
    // The demo uses relative /api paths, so forward them in development.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true
      }
    }
  },
  preview: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true
      }
    }
  }
});
