import { defineConfig } from 'tsdown'

/** Private worker and preloader are loaded only by the Host-created dsh Profile. */
export default defineConfig(({ env }) => env?.DSH_BUILD_FACE === 'client' ? [] :
  ['index', 'worker', 'startup'].map(name => ({
    entry: [`lib/types/${name}.js`], outDir: 'lib', format: ['esm'], platform: 'node',
    target: 'es2024', fixedExtension: false, dts: false, clean: false,
  })))
