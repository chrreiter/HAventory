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
      output: {
        // The integration serves exactly one bundle at
        // /haventory_static/haventory-card.js, so the build must emit a single
        // file — no chunk may be split out. Vite leaves this unset for an `es`
        // lib build, so a dynamic import would otherwise become a second chunk.
        codeSplitting: false
      }
    },
    minify: true,
    sourcemap: false,
    target: 'es2020',  // Match HA browser support
    // Inside the integration package: that directory is the only tree HACS
    // copies for an integration-category repo, and the integration serves it
    // over its own static path.
    outDir: '../../custom_components/haventory/www',
    emptyOutDir: false
  }
});
