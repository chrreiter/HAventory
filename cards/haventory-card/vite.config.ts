import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test.setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'html', 'json-summary', 'lcov'],
      // Vitest 4 removed `coverage.all` and reports only touched files by
      // default; list the source set explicitly so uncovered files still count.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test.setup.ts', 'src/test.utils.ts']
    }
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'haventory-card.js'
    },
    rollupOptions: {
      external: [],  // Bundle everything since HA doesn't provide dependencies
      output: {
        inlineDynamicImports: true  // Single file output for HACS
      }
    },
    minify: true,
    sourcemap: false,
    target: 'es2020',  // Match HA browser support
    outDir: '../www/haventory',
    emptyOutDir: false
  }
});
