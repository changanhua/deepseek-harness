/** Built-profile acceptance for the private, durable Content Domain. */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const root = resolve(import.meta.dirname, '../../..')
const builtBin = resolve(root, 'apps/cli/lib/bin.js')
const builtContentProvider = resolve(root, 'packages/content/content-domain/lib/index.js')
const profileName = 'content-domain-built'
const timeoutMs = 45_000
const fixtureProbe = pathToFileURL(resolve(import.meta.dirname, 'fixtures/content-domain-probe.mjs')).href

interface Fixture {
  readonly home: string
  readonly resultFile: string
  readonly ordinaryDatabase: string
  readonly contentDatabase: string
}

interface ProbeResult {
  readonly phase: string
  readonly status: { readonly phase: string; readonly reason: string | null }
  readonly ordinary: string
  readonly entry?: {
    readonly id: string
    readonly original: string
    readonly current: string
    readonly versions: number
  }
  readonly receipts?: {
    readonly capture: {
      readonly operationId: string
      readonly entryId: string
      readonly entryRevision: number
    }
    readonly commit: {
      readonly operationId: string
      readonly entryId: string
      readonly entryRevision: number
      readonly versionId: string | null
    }
  }
}

async function fixture(): Promise<Fixture> {
  // The machine's shared TEMP ancestors need not satisfy owner-private storage policy.
  const home = await mkdtemp(join(process.platform === 'win32' ? homedir() : tmpdir(), 'dsh-content-domain-built-'))
  const profileDir = join(home, 'profiles', profileName)
  const bundleDir = join(profileDir, 'node_modules', 'dsh-content-domain-built-bundle')
  const resultFile = join(home, 'content-domain-result.json')
  const ordinaryDatabase = join(home, 'probe', 'ordinary.sqlite')
  const contentDatabase = join(home, 'content', 'main', 'content.sqlite')
  await mkdir(bundleDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-content-domain-built',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-content-domain-built-bundle'], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  await writeFile(join(bundleDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-content-domain-built-bundle',
    private: true,
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`)
  await writeFile(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: content-storage',
    `      name: ${pathToFileURL(join(root, 'packages/storage/storage/lib/index.js')).href}`,
    '    - id: ordinary-sqlite',
    `      name: ${pathToFileURL(join(root, 'packages/storage/storage-sqlite/lib/index.js')).href}`,
    '      config:',
    '        backendName: ordinary_sqlite',
    "        path: 'probe/ordinary.sqlite'",
    '        pathBase: dsh-home',
    '    - id: content-sqlite',
    `      name: ${pathToFileURL(join(root, 'packages/storage/storage-sqlite/lib/index.js')).href}`,
    '      config:',
    '        backendName: content_sqlite',
    "        path: 'content/main/content.sqlite'",
    '        pathBase: dsh-home',
    '        journalMode: delete',
    '        ownership: exclusive',
    '        synchronous: extra',
    `        applicationId: ${0x44534843}`,
    '        privateDirectory: true',
    '    - id: content-storage-domain',
    `      name: ${pathToFileURL(join(root, 'packages/storage/storage-domain/lib/index.js')).href}`,
    '      config:',
    '        backend: ordinary_sqlite',
    '        routes:',
    '          content_library: content_sqlite',
    '    - id: content-domain',
    `      name: ${pathToFileURL(builtContentProvider).href}`,
    '    - id: content-domain-probe',
    `      name: ${fixtureProbe}`,
    '',
  ].join('\n'))
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return { home, resultFile, ordinaryDatabase, contentDatabase }
}

async function run(fixture: Fixture, phase: 'write' | 'read' | 'invalid-identity'): Promise<ProbeResult> {
  const launch = resolveExampleLaunch({
    srcBin: resolve(root, 'apps/cli/src/bin.ts'),
    libBin: builtBin,
    configArgs: ['--profile', profileName],
    mode: 'lib',
    env: {
      DSH_HOME: fixture.home,
      DSH_AGENTS_HOME: join(fixture.home, '.agents'),
      DSH_TELEMETRY_DISABLED: '1',
      DSH_CONTENT_PROBE_PHASE: phase,
      DSH_CONTENT_PROBE_RESULT: fixture.resultFile,
      NODE_PATH: '',
    },
  })
  const result = await execa(launch.command, launch.args, {
    cwd: root,
    env: { ...scrubbedParentEnv(), ...launch.env },
    extendEnv: false,
    input: '',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    reject: false,
    windowsHide: true,
  })
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(`content-domain built profile ${phase} failed. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return JSON.parse(readFileSync(fixture.resultFile, 'utf8')) as ProbeResult
}

function rows(database: string, table: string): Array<{ key: string; value: string }> {
  const db = new DatabaseSync(database, { allowExtension: false })
  try {
    return db.prepare(`SELECT key, value FROM "${table}" ORDER BY key`).all() as Array<{ key: string; value: string }>
  } finally {
    db.close()
  }
}

function setWrongApplicationId(database: string): void {
  const db = new DatabaseSync(database, { allowExtension: false })
  try {
    db.exec('PRAGMA application_id = 1145390671')
  } finally {
    db.close()
  }
}

describe.skipIf(!existsSync(builtBin) || !existsSync(builtContentProvider))('content domain through the built dsh profile', () => {
  it('preserves captured CRLF text, versions and retry receipts across restarts while isolating a rejected content medium', async () => {
    const current = await fixture()
    try {
      const written = await run(current, 'write')
      expect(written.status).toMatchObject({ phase: 'ready', reason: null })
      expect(written.entry).toMatchObject({
        original: '第一行\r\n第二行：原文', current: '第一行\r\n第二行：版本二', versions: 2,
      })
      expect(written.ordinary).toBe('written')

      // This independently reads the medium after the Host exits. The probe's
      // own success report therefore cannot be the only evidence of a commit.
      const contentRows = rows(current.contentDatabase, 'u_content_library_entries')
      expect(contentRows).toHaveLength(1)
      expect(contentRows[0]?.value).toContain('第一行\\r\\n第二行：原文')
      expect(contentRows[0]?.value).toContain('第一行\\r\\n第二行：版本二')
      expect(rows(current.ordinaryDatabase, 'u_ordinary_probe_rows')).toEqual([
        { key: 'ordinary', value: JSON.stringify({ value: 'written' }) },
      ])

      const reopened = await run(current, 'read')
      expect(reopened.status).toMatchObject({ phase: 'ready', reason: null })
      expect(reopened.entry).toMatchObject({
        original: '第一行\r\n第二行：原文', current: '第一行\r\n第二行：版本二', versions: 2,
      })
      expect(reopened.receipts).toEqual(written.receipts)
      expect(reopened.ordinary).toBe('reopened')

      setWrongApplicationId(current.contentDatabase)
      const rejected = await run(current, 'invalid-identity')
      expect(rejected.status).toMatchObject({ phase: 'unavailable', reason: 'storage_failed' })
      expect(rejected.ordinary).toBe('survived-content-rejection')
      expect(rows(current.ordinaryDatabase, 'u_ordinary_probe_rows')).toEqual([
        { key: 'ordinary', value: JSON.stringify({ value: 'survived-content-rejection' }) },
      ])
    } finally {
      await rm(current.home, { recursive: true, force: true })
    }
  }, timeoutMs * 3 + 20_000)
})
