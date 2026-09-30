import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'
const names = ['inventory-snapshot', 'page-model', 'puzzle-solver', 'core', 'quote-preflight', 'readiness-facts']
/** Bundle the existing pure algorithm source without an app-source dependency in published Host output. */
export default defineConfig({
  entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  alias: Object.fromEntries(names.map(name => [`../../../../apps/chrome-extension/src/fc-sbc-${name}.js`,
    fileURLToPath(new URL(`../../../apps/chrome-extension/src/fc-sbc-${name}.js`, import.meta.url))])),
})
