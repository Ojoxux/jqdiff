import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 60_000,
    // runner と traps は 1 テストごとに Chromium を起動する。並列に走らせると
    // ブラウザ同士が資源を奪い合い、描画が止まって再生が固まる。
    fileParallelism: false,
  },
})
