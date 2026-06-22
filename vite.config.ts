/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// 純粋ロジック(src/game)は node 環境で、描画(src/render)はブラウザ手動確認で検証する。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
