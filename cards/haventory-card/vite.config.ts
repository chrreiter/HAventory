import { existsSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { runnerImport } from 'vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import type { Dictionary } from './src/i18n';

const ENTRY = resolve(import.meta.dirname, 'src/index.ts');
// Inside the integration package: that directory is the only tree HACS copies
// for an integration-category repo, and the integration serves it over its own
// static path.
const OUT_DIR = resolve(import.meta.dirname, '../../custom_components/haventory/www');
/** The copies aiohttp's `FileResponse` looks for beside a requested file. */
const COMPRESSED_COPY = /\.js\.(br|gz)$/;
const I18N = resolve(import.meta.dirname, 'src/i18n/index.ts');
/** The namespace `LoaderKey` in `src/i18n/loader-copy.ts` is drawn from. */
const LOADER_PREFIX = 'hv.loader.';

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

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * A `.br` and a `.gz` copy beside every emitted `.js`. Home Assistant compresses
 * no static file itself; aiohttp sends the copy a request's `Accept-Encoding`
 * allows and never checks that it still matches the `.js`. So the entry, whose
 * name never changes, loses its old copies before the build starts (`chunks/` is
 * emptied whole): a build that fails after writing the `.js` must not leave the
 * last build's code being served in its place. The setup sweep in
 * `stale_files.py` catches the same mismatch on an install.
 */
function compressedCopies(): Plugin {
  return {
    name: 'haventory-compressed-copies',
    apply: 'build',
    buildStart() {
      if (!existsSync(OUT_DIR)) return;
      for (const name of readdirSync(OUT_DIR)) {
        if (COMPRESSED_COPY.test(name)) rmSync(resolve(OUT_DIR, name), { force: true });
      }
    },
    async writeBundle(options, bundle) {
      const dir = options.dir ?? OUT_DIR;
      const scripts = Object.keys(bundle).filter((fileName) => fileName.endsWith('.js'));
      await Promise.all(
        scripts.map(async (fileName) => {
          const path = resolve(dir, fileName);
          const source = await readFile(path);
          const [br, gz] = await Promise.all([
            brotli(source, {
              params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
                [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.length,
              },
            }),
            gzipAsync(source, { level: zlibConstants.Z_BEST_COMPRESSION }),
          ]);
          await Promise.all([writeFile(`${path}.br`, br), writeFile(`${path}.gz`, gz)]);
        }),
      );
    },
  };
}

/**
 * `__HV_LOADER_COPY__`: every dictionary's `hv.loader.*` strings, which a host's
 * placeholder says once the runtime will not load. The catalogs are in the
 * runtime chunk, the file that failed, so these few are written into the core
 * chunk instead. Defined for the tests as well, so they read what the build
 * writes. The catalogs are read through Vite's module runner: imported here,
 * their extensionless TypeScript imports would have Vite warn on every run that
 * its native config loader cannot follow them.
 */
function loaderCopy(): Plugin {
  return {
    name: 'haventory-loader-copy',
    async config() {
      const { module } = await runnerImport<{ DICTIONARIES: Readonly<Record<string, Dictionary>> }>(I18N);
      const copy = Object.fromEntries(
        Object.entries(module.DICTIONARIES).map(([tag, dictionary]) => [
          tag,
          Object.fromEntries(Object.entries(dictionary).filter(([key]) => key.startsWith(LOADER_PREFIX))),
        ]),
      );
      return { define: { __HV_LOADER_COPY__: JSON.stringify(copy) } };
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
  plugins: [emptyChunksDir(), compressedCopies(), loaderCopy()],
  test: {
    environment: 'jsdom',
    // Each file still gets its own context and its own custom-element registry,
    // so a failure stays with the file that caused it; what this saves is
    // building a fresh jsdom worker per file, which was half the run.
    pool: 'vmThreads',
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
