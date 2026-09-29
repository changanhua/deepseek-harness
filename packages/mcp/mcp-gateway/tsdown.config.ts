import { defineConfig } from 'tsdown'

export default defineConfig(({ env }) => ({
  entry: env?.DSH_BUILD_FACE === 'client' ? '' : ['lib/types/index.js', 'lib/types/connector.js'],
  format: 'esm', platform: 'node', target: 'es2024', outDir: 'lib', clean: false,
  outExtensions: () => ({ js: '.js' }),
}))
