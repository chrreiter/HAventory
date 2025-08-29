import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts']
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
