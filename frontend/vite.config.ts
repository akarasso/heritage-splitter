import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  envDir: process.env.VITE_ENV_DIR || ".",
  server: {
    port: parseInt(process.env.DEV_PORT || "3000"),
    host: true,
    proxy: {
      "/api": {
        target: process.env.API_TARGET || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "~": "/src",
    },
  },
});
