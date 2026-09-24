import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/…` is `src/…` here, in vitest (which reads this file) and in tsc (tsconfig `paths`).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: {
    environment: 'jsdom',
    // Building a fresh jsdom per file was ~80% of suite time and starved slow CI
    // runners into 5 s timeouts; vmThreads keeps per-file isolation at a third of the cost.
    pool: 'vmThreads',
    // The cockpit and sidebar tests mount a whole pane, and on the windows runner that is
    // three times slower than anywhere else: three of them crossed the 5 s default while
    // their own assertions were fine, one of them beside a test doing the same render that
    // passed. 20 s leaves headroom over the slowest real run measured (16.8 s) without
    // letting a genuinely hung test sit there for a minute.
    testTimeout: 20_000,
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
  },
})
