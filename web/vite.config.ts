/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // ローカル開発時: `npm run dev:web`（このVite開発サーバー）がフロントエンドを配信し、
    // `npm run dev:server`（Fastify、既定でポート3000）がAPIを配信する2プロセス構成のため、
    // `/api` 宛のリクエストをFastifyサーバーへプロキシする（task 6.1: 「ローカル開発時の
    // プロキシ設定」。本番ビルドでは `web/dist` をFastifyの `registerStaticFrontend`
    // （`server/src/static-frontend.ts`）が直接静的配信するため、このプロキシは不要になる）。
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
