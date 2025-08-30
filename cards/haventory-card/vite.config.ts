import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'html', 'json-summary', 'lcov']
    },
    setupFiles: []
  },
  build: {
    outDir: '../www/haventory',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        entryFileNames: `haventory-card.js`
      }
    }
  }
});
