import { mkdtemp, readFile, readdir, rm, copyFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { fixture } from './fixture.ts'
const execute = promisify(execFile)
/** Built-only smoke: run after focused tsc+tsdown or the normal Host build. */
it.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib')('loads an isolated built owner through Loader in plain Node and survives restart without app source', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url))
  const root = await mkdtemp(join(tmpdir(), 'fc-built-'))
  try {
    const owner = resolve(repository, 'packages/domain-runtime/fc-sbc-domain')
    const isolated = join(root, 'fc-owner.mjs')
    await copyFile(join(owner, 'lib/index.js'), isolated)
    await symlink(join(owner, 'node_modules'), join(root, 'node_modules'), 'dir')
    const inputFile = join(root, 'observation.json'); await writeFile(inputFile, JSON.stringify(fixture()))
    for (const file of await readdir(join(owner, 'lib/types'))) if (file.endsWith('.d.ts')) expect(await readFile(join(owner,
      'lib/types', file), 'utf8')).not.toContain('apps/chrome-extension')
    const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('./fixtures/built-driver.mjs', import.meta.url)),
      repository, root, isolated, inputFile], { timeout: 30000 })
    const result = JSON.parse(stdout)
    expect(result).toMatchObject({ restarted: true, forbiddenCalls: 0, payload: { solver: { searchComplete: false },
      quoteStatus: { status: 'missing' } } })
    expect(result.payload.realityRef).toEqual(result.realityRef)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 45000)
