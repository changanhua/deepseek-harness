/** Generate the build-time package catalog used by the Architecture client. */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  collectArchitectureCatalog,
  renderArchitectureCatalogModule,
} from './architecture-catalog.ts'

const root = resolve(import.meta.dirname, '..')
const output = 'packages/client/ui-architecture/src/client/catalog.generated.ts'
const content = renderArchitectureCatalogModule(collectArchitectureCatalog(root))
const path = resolve(root, output)

if (process.argv.includes('--check')) {
  let committed: string | undefined
  try {
    committed = readFileSync(path, 'utf8')
  } catch {
    committed = undefined
  }
  if (committed === content) {
    console.log(`gen-architecture-catalog: ${output} is up to date.`)
    process.exit(0)
  }
  console.error(`gen-architecture-catalog: ${output} is stale. Run \`pnpm run gen-architecture-catalog\`.`)
  process.exit(1)
}

writeFileSync(path, content)
console.log(`gen-architecture-catalog: wrote ${output}.`)
