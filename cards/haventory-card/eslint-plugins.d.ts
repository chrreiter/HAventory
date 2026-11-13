// eslint-plugin-lit-a11y ships no type declarations. Its default export is an
// ordinary ESLint plugin, which is all eslint.config.js reads from it.
declare module 'eslint-plugin-lit-a11y' {
  import type { ESLint } from 'eslint';

  const plugin: ESLint.Plugin;
  export default plugin;
}
