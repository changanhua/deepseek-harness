import { defineConfig } from 'tsdown'

/** Emit both Node entrypoints declared by the Web profile bundle. */
export default defineConfig(({ env }) => env?.DSH_BUILD_FACE === 'client'
  ? { entry: '' }
  : {
      entry: {
        index: 'lib/types/index.js',
        startup: 'lib/types/startup.js',
      },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
    })
