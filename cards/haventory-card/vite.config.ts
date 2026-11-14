import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const ENTRY = resolve(import.meta.dirname, 'src/index.ts');
// Inside the integration package: that directory is the only tree HACS copies
// for an integration-category repo, and the integration serves it over its own
// static path.
const OUT_DIR = resolve(import.meta.dirname, '../../custom_components/haventory/www');

/**
 * `chunks/` holds only what one build emitted. A chunk name changes with its
 * content, so without this every rebuild would leave the last one's beside it.
 * The rest of `www/` is left alone, which is why `emptyOutDir` stays off.
 */
function emptyChunksDir(): Plugin {
  return {
    name: 'haventory-empty-chunks-dir',
    apply: 'build',
    buildStart() {
      rmSync(resolve(OUT_DIR, 'chunks'), { recursive: true, force: true });
    },
  };
}

type ModuleInfoLookup = (id: string) => { importers: readonly string[] } | null;
const knownEager = new Set<string>();

/**
 * Is `id` reachable from the entry through static imports alone? Only a yes is
 * remembered: a no found inside an import cycle is provisional.
 */
function isEager(id: string, getModuleInfo: ModuleInfoLookup, seen = new Set<string>()): boolean {
  if (id === ENTRY) return false;
  if (knownEager.has(id)) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const importers = getModuleInfo(id)?.importers ?? [];
  const eager = importers.some((importer) => importer === ENTRY || isEager(importer, getModuleInfo, seen));
  if (eager) knownEager.add(id);
  return eager;
}

export default defineConfig({
  plugins: [emptyChunksDir()],
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
      exclude: ['src/**/*.test.ts', 'src/test.setup.ts', 'src/test.utils.ts'],
    },
  },
  build: {
    // An application build rather than library mode: Vite leaves whitespace
    // unminified in an `es` library build.
    rollupOptions: {
      input: 'src/index.ts',
      preserveEntrySignatures: false,
      output: {
        entryFileNames: 'haventory-card.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        // Everything the entry imports statically goes into one hashed chunk, so
        // no chunk ever imports the entry: that import would carry no `?v=`, load
        // the entry a second time and define every element twice.
        manualChunks: (id, { getModuleInfo }) => (isEager(id, getModuleInfo) ? 'core' : undefined),
      },
    },
    manifest: 'chunks/manifest.json',
    modulePreload: false,
    minify: true,
    sourcemap: false,
    target: 'es2020', // Match HA browser support
    // The runtime is one chunk on purpose: a tab that has loaded it never needs
    // another file, so an upgrade under an open tab cannot strand it halfway.
    chunkSizeWarningLimit: 800,
    outDir: OUT_DIR,
    emptyOutDir: false,
  },
});
