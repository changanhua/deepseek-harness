import { defineConfig } from 'tsdown'

const entry = (path: string) => ({
  entry: [path],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
})

/** Build every supported entry as a self-contained file admitted by the package whitelist. */
export default defineConfig([
  entry('lib/types/index.js'),
  entry('lib/types/app-server-run.js'),
  entry('lib/types/invariant.js'),
])
