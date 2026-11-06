// Sodium's lint. Run it from the project root:
//   npx eslint -c sodium.eslint.config.mjs .
// It flags what Sodium's rules forbid in app code (two primary buttons in one group, glass on something nobody presses, a
// shadow, mono at the sans size, raw colors, classes Sodium's theme lacks, native controls ...) and each message says
// what to use instead. Sodium's own components (components/sodium/ui, components/sodium/ai, components/sodium/icon.tsx and
// lib/sodium) are held to the rules that apply to them; its blocks in
// components/sodium/blocks are screens the app owns, so they get the app rules.
//
// Already have an eslint.config? Add Sodium to it instead:
//   import sodium from './sodium.eslint.config.mjs';
//   export default [...yourConfig, ...sodium];
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import tsParser from '@typescript-eslint/parser';

/** The plugin: beside this file, or in the lib folder shadcn put it in (lib/sodium/lint, src/lib/sodium/lint, or the components.json lib alias). */
function pluginPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = [here, join(here, 'lib/sodium/lint'), join(here, 'src/lib/sodium/lint')];
  try {
    const alias = JSON.parse(readFileSync(join(here, 'components.json'), 'utf8')).aliases?.lib;
    if (alias) dirs.push(...['', 'src'].map(base => join(here, base, alias.replace(/^[@~]\//, ''), 'sodium/lint')));
  } catch {}
  const found = dirs.map(dir => join(dir, 'plugin.mjs')).find(existsSync);
  if (!found) throw new Error('Sodium lint: lib/sodium/lint/plugin.mjs is missing. Run npx shadcn@latest add https://design.how/r/sodium/lint.json');
  return found;
}

const plugin = pluginPath();
const sodium = (await import(pathToFileURL(plugin).href)).default;
// The paths every system's lint skips (build output, shadcn's own components/ui), from the shared file beside the plugin.
const {LINT_IGNORES} = await import(pathToFileURL(join(dirname(plugin), 'value-rules.mjs')).href);

export default [
  {ignores: [...LINT_IGNORES, '**/lib/sodium/lint/**', '**/*.test.{ts,tsx}']},
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {parser: tsParser, parserOptions: {ecmaFeatures: {jsx: true}}},
    linterOptions: {reportUnusedDisableDirectives: 'off'},
    plugins: {sodium},
    processor: 'sodium/standalone',
    rules: sodium.configs.app.rules,
  },
  {files: ['**/components/sodium/{ui,ai}/**', '**/components/sodium/icon.tsx', '**/lib/sodium/**'], rules: sodium.configs.source.rules},
];
