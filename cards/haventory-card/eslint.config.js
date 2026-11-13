// @ts-check
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import lit from 'eslint-plugin-lit';
import litA11y from 'eslint-plugin-lit-a11y';
import wc from 'eslint-plugin-wc';

/**
 * The rules a plugin preset turns on. Plugins type their presets as any config
 * shape (flat, legacy or an array of flat ones), so the shape is checked where it
 * is read, and a renamed preset fails loudly instead of linting with nothing.
 *
 * @template {{ rules?: unknown }} T
 * @param {T | readonly unknown[] | undefined} preset
 * @param {string} name
 */
function presetRules(preset, name) {
  if (!preset || !('rules' in preset) || !preset.rules) throw new Error(`no rules in preset ${name}`);
  return preset.rules;
}

export default [
  { ignores: ['coverage/**', 'www/**', 'dist/**', 'node_modules/**'] },

  js.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      // Type information for the rules that need it, from the tsconfig.json that
      // includes the file: the same program `npm run typecheck` builds.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin, lit, wc, 'lit-a11y': litA11y },
    rules: {
      ...presetRules(tsPlugin.configs['flat/eslint-recommended'], 'typescript-eslint eslint-recommended'),
      ...presetRules(
        tsPlugin.configs['recommended-type-checked'],
        'typescript-eslint recommended-type-checked',
      ),
      ...presetRules(lit.configs?.recommended, 'lit recommended'),
      ...presetRules(wc.configs?.recommended, 'wc recommended'),
      ...presetRules(litA11y.configs?.recommended, 'lit-a11y recommended'),
      // TypeScript handles undefined variables; avoid false positives in TS code
      'no-undef': 'off',
      // Lit calls a template listener (`@click=${this._onClick}`) with the host as
      // `this`, which the rule cannot see; code outside templates calls through `.call`.
      '@typescript-eslint/unbound-method': 'off',
      // An open vocabulary is written `KnownValue | string` to name its known members.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },

  {
    files: ['src/**/*.test.ts', 'src/test.utils.ts', 'src/test.setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Tests read private state and build partial payloads through `any`, as above.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // A mock stands in for an async method and keeps its signature.
      '@typescript-eslint/require-await': 'off',
      // Home Assistant's connection rejects with plain `{ code, message }` objects.
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Opt-in browser smoke scripts: mixed Node + in-page (browser) globals. These run
  // outside the shipped bundle and are not type-checked, so defer undefined-name
  // checking (as the TS blocks do) rather than enumerating both runtimes' globals.
  // Must come after js.configs.recommended so it wins for these files.
  {
    files: ['e2e/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-undef': 'off' },
  },
];
